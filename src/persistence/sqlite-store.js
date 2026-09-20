import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { assertTransition } from '../domain/state-machine.js';
import { AppError, invariant } from '../domain/errors.js';

function parse(value) {
  return value == null ? null : JSON.parse(value);
}

function now() {
  return new Date().toISOString();
}

export class SqliteStore {
  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    this.migrate();
  }

  close() {
    this.db.close();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        realm_id TEXT NOT NULL UNIQUE,
        country TEXT NOT NULL,
        currency TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        toast_location_id TEXT NOT NULL,
        timezone TEXT NOT NULL,
        department_ref TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sync_paused INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_toast_location
        ON locations(toast_location_id) WHERE active = 1;
      CREATE TABLE IF NOT EXISTS mappings (
        location_id TEXT NOT NULL REFERENCES locations(id),
        version INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        PRIMARY KEY(location_id, version)
      );
      CREATE TABLE IF NOT EXISTS days (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        realm_id TEXT NOT NULL,
        location_id TEXT NOT NULL REFERENCES locations(id),
        business_date TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        source_json TEXT NOT NULL,
        pending_source_json TEXT,
        status TEXT NOT NULL,
        mapping_version INTEGER,
        journal_json TEXT,
        qb_journal_id TEXT,
        qb_snapshot_json TEXT,
        reversal_qb_id TEXT,
        replacement_qb_id TEXT,
        correction_version INTEGER NOT NULL DEFAULT 0,
        dismissed_duplicate INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(realm_id, location_id, business_date)
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        day_id TEXT NOT NULL REFERENCES days(id),
        idempotency_key TEXT NOT NULL UNIQUE,
        doc_number TEXT NOT NULL,
        kind TEXT NOT NULL,
        outcome TEXT NOT NULL,
        qb_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entitlements (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
        body_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
    `);
    const columns = this.db.prepare('PRAGMA table_info(days)').all().map((column) => column.name);
    if (!columns.includes('correction_version')) this.db.exec('ALTER TABLE days ADD COLUMN correction_version INTEGER NOT NULL DEFAULT 0;');
    this.db.exec('INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);');
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createWorkspace({ id, realmId, country, currency }) {
    invariant(`${country}/${currency}` === 'US/USD' || `${country}/${currency}` === 'CA/CAD',
      'UNSUPPORTED_COUNTRY_CURRENCY', 'Only US/USD and CA/CAD workspaces are supported.');
    try {
      this.db.prepare('INSERT INTO workspaces(id, realm_id, country, currency, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, realmId, country, currency, now());
    } catch (error) {
      throw new AppError('WORKSPACE_CONFLICT', 'A workspace already uses this QuickBooks realm or ID.', { id, realmId }, error);
    }
    return this.getWorkspace(id);
  }

  getWorkspace(id) {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    return row ? { id: row.id, realmId: row.realm_id, country: row.country, currency: row.currency, createdAt: row.created_at } : null;
  }

  createLocation({ id, workspaceId, toastLocationId, timezone, departmentRef = id }) {
    try {
      this.db.prepare(`INSERT INTO locations(id, workspace_id, toast_location_id, timezone, department_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, workspaceId, toastLocationId, timezone, departmentRef, now());
    } catch (error) {
      throw new AppError('LOCATION_CONFLICT', 'A Toast location can belong to only one workspace.', { id, toastLocationId }, error);
    }
    return this.getLocation(id);
  }

  getLocation(id) {
    const row = this.db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
    return row ? {
      id: row.id, workspaceId: row.workspace_id, toastLocationId: row.toast_location_id,
      timezone: row.timezone, departmentRef: row.department_ref, active: Boolean(row.active),
      syncPaused: Boolean(row.sync_paused), createdAt: row.created_at,
    } : null;
  }

  saveMapping(locationId, mapping) {
    this.db.prepare('INSERT INTO mappings(location_id, version, body_json, approved_at) VALUES (?, ?, ?, ?)')
      .run(locationId, mapping.version, JSON.stringify(mapping), now());
    return mapping;
  }

  getMapping(locationId, version) {
    const row = version == null
      ? this.db.prepare('SELECT body_json FROM mappings WHERE location_id = ? ORDER BY version DESC LIMIT 1').get(locationId)
      : this.db.prepare('SELECT body_json FROM mappings WHERE location_id = ? AND version = ?').get(locationId, version);
    return row ? parse(row.body_json) : null;
  }

  putEntitlement(workspaceId, entitlement) {
    this.db.prepare(`INSERT INTO entitlements(workspace_id, body_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET body_json = excluded.body_json, updated_at = excluded.updated_at`)
      .run(workspaceId, JSON.stringify(entitlement), now());
  }

  getEntitlement(workspaceId) {
    const row = this.db.prepare('SELECT body_json FROM entitlements WHERE workspace_id = ?').get(workspaceId);
    return row ? parse(row.body_json) : null;
  }

  createDay(source, status, journal = null) {
    const id = randomUUID();
    const stamp = now();
    this.db.prepare(`INSERT INTO days(id, workspace_id, realm_id, location_id, business_date, source_fingerprint,
      source_json, status, mapping_version, journal_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, source.workspaceId, source.realmId, source.locationId, source.businessDate, source.sourceFingerprint,
        JSON.stringify(source), status, journal?.mappingVersion ?? null, journal ? JSON.stringify(journal) : null, stamp, stamp);
    return this.getDay(id);
  }

  getDay(id) {
    const row = this.db.prepare('SELECT * FROM days WHERE id = ?').get(id);
    return this.#day(row);
  }

  getDayByIdentity({ realmId, locationId, businessDate }) {
    const row = this.db.prepare('SELECT * FROM days WHERE realm_id = ? AND location_id = ? AND business_date = ?')
      .get(realmId, locationId, businessDate);
    return this.#day(row);
  }

  listDays(workspaceId) {
    return this.db.prepare('SELECT * FROM days WHERE workspace_id = ? ORDER BY business_date, location_id').all(workspaceId).map((row) => this.#day(row));
  }

  purgeWorkspace(workspaceId) {
    return this.transaction(() => {
      const locationIds = this.db.prepare('SELECT id FROM locations WHERE workspace_id = ?').all(workspaceId).map((row) => row.id);
      for (const locationId of locationIds) {
        this.db.prepare('DELETE FROM attempts WHERE day_id IN (SELECT id FROM days WHERE location_id = ?)').run(locationId);
        this.db.prepare('DELETE FROM days WHERE location_id = ?').run(locationId);
        this.db.prepare('DELETE FROM mappings WHERE location_id = ?').run(locationId);
      }
      this.db.prepare('DELETE FROM entitlements WHERE workspace_id = ?').run(workspaceId);
      this.db.prepare('DELETE FROM locations WHERE workspace_id = ?').run(workspaceId);
      const result = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
      return Number(result.changes);
    });
  }

  setLocationActive(locationId, active) {
    this.db.prepare('UPDATE locations SET active = ? WHERE id = ?').run(Number(Boolean(active)), locationId);
    return this.getLocation(locationId);
  }

  setLocationSyncPaused(locationId, paused) {
    this.db.prepare('UPDATE locations SET sync_paused = ? WHERE id = ?').run(Number(Boolean(paused)), locationId);
    return this.getLocation(locationId);
  }

  transition(dayId, status, patch = {}) {
    const current = this.getDay(dayId);
    invariant(current, 'DAY_NOT_FOUND', 'Sync day not found.', { dayId });
    assertTransition(current.status, status);
    const values = {
      source_json: patch.source ? JSON.stringify(patch.source) : JSON.stringify(current.source),
      pending_source_json: patch.pendingSource === undefined ? (current.pendingSource ? JSON.stringify(current.pendingSource) : null) : (patch.pendingSource ? JSON.stringify(patch.pendingSource) : null),
      source_fingerprint: patch.source?.sourceFingerprint ?? current.sourceFingerprint,
      mapping_version: patch.mappingVersion === undefined ? current.mappingVersion : patch.mappingVersion,
      journal_json: patch.journal === undefined ? (current.journal ? JSON.stringify(current.journal) : null) : (patch.journal ? JSON.stringify(patch.journal) : null),
      qb_journal_id: patch.qbJournalId === undefined ? current.qbJournalId : patch.qbJournalId,
      qb_snapshot_json: patch.qbSnapshot === undefined ? (current.qbSnapshot ? JSON.stringify(current.qbSnapshot) : null) : (patch.qbSnapshot ? JSON.stringify(patch.qbSnapshot) : null),
      reversal_qb_id: patch.reversalQbId === undefined ? current.reversalQbId : patch.reversalQbId,
      replacement_qb_id: patch.replacementQbId === undefined ? current.replacementQbId : patch.replacementQbId,
      correction_version: patch.correctionVersion === undefined ? current.correctionVersion : patch.correctionVersion,
      dismissed_duplicate: patch.dismissedDuplicate === undefined ? Number(current.dismissedDuplicate) : Number(Boolean(patch.dismissedDuplicate)),
      error_code: patch.errorCode === undefined ? current.errorCode : patch.errorCode,
      error_json: patch.error === undefined ? (current.error ? JSON.stringify(current.error) : null) : (patch.error ? JSON.stringify(patch.error) : null),
    };
    this.db.prepare(`UPDATE days SET status = ?, source_json = ?, pending_source_json = ?, source_fingerprint = ?,
      mapping_version = ?, journal_json = ?, qb_journal_id = ?, qb_snapshot_json = ?, reversal_qb_id = ?,
      replacement_qb_id = ?, correction_version = ?, dismissed_duplicate = ?, error_code = ?, error_json = ?, updated_at = ? WHERE id = ?`)
      .run(status, values.source_json, values.pending_source_json, values.source_fingerprint, values.mapping_version,
        values.journal_json, values.qb_journal_id, values.qb_snapshot_json, values.reversal_qb_id,
        values.replacement_qb_id, values.correction_version, values.dismissed_duplicate, values.error_code, values.error_json, now(), dayId);
    return this.getDay(dayId);
  }

  recordAttempt({ dayId, idempotencyKey, docNumber, kind, outcome, qbId = null }) {
    const stamp = now();
    this.db.prepare(`INSERT INTO attempts(id, day_id, idempotency_key, doc_number, kind, outcome, qb_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET outcome = excluded.outcome, qb_id = excluded.qb_id, updated_at = excluded.updated_at`)
      .run(randomUUID(), dayId, idempotencyKey, docNumber, kind, outcome, qbId, stamp, stamp);
    return this.getAttempt(idempotencyKey);
  }

  getAttempt(idempotencyKey) {
    const row = this.db.prepare('SELECT * FROM attempts WHERE idempotency_key = ?').get(idempotencyKey);
    return row ? { id: row.id, dayId: row.day_id, idempotencyKey: row.idempotency_key, docNumber: row.doc_number, kind: row.kind, outcome: row.outcome, qbId: row.qb_id } : null;
  }

  #day(row) {
    if (!row) return null;
    return {
      id: row.id, workspaceId: row.workspace_id, realmId: row.realm_id, locationId: row.location_id,
      businessDate: row.business_date, sourceFingerprint: row.source_fingerprint,
      source: parse(row.source_json), pendingSource: parse(row.pending_source_json), status: row.status,
      mappingVersion: row.mapping_version, journal: parse(row.journal_json), qbJournalId: row.qb_journal_id,
      qbSnapshot: parse(row.qb_snapshot_json), reversalQbId: row.reversal_qb_id,
      replacementQbId: row.replacement_qb_id, correctionVersion: row.correction_version,
      dismissedDuplicate: Boolean(row.dismissed_duplicate),
      errorCode: row.error_code, error: parse(row.error_json), createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}
