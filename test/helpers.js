import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SqliteStore } from '../src/persistence/sqlite-store.js';
import { FakeQuickBooks } from '../src/adapters/fake-quickbooks.js';
import { SyncEngine } from '../src/domain/engine.js';

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(name) {
  return JSON.parse(readFileSync(join(here, '..', 'fixtures', name), 'utf8'));
}

export function setup({ market = 'US', database = ':memory:', paid = true } = {}) {
  const source = fixture(market === 'CA' ? 'ca-day.json' : 'us-day.json');
  const mapping = fixture(market === 'CA' ? 'ca-mapping.json' : 'us-mapping.json');
  const store = new SqliteStore(database);
  store.createWorkspace({ id: source.workspaceId, realmId: source.realmId, country: source.country, currency: source.currency });
  store.createLocation({ id: source.locationId, workspaceId: source.workspaceId, toastLocationId: `toast-${source.locationId}`, timezone: source.timezone });
  store.saveMapping(source.locationId, mapping);
  store.putEntitlement(source.workspaceId, paid
    ? { status: 'PAID', syncPaused: false }
    : { status: 'NOT_STARTED', syncPaused: false });
  const quickBooks = new FakeQuickBooks();
  const engine = new SyncEngine({ store, quickBooks, clock: () => '2026-09-20T12:00:00.000Z' });
  return { source, mapping, store, quickBooks, engine };
}
