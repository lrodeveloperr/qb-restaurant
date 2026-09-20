import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SqliteStore } from '../persistence/sqlite-store.js';
import { FakeQuickBooks } from '../adapters/fake-quickbooks.js';
import { SyncEngine } from '../domain/engine.js';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

export function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixtureDirectory, name), 'utf8'));
}

export function createHarness({ market = 'US', entitlement } = {}) {
  const source = loadFixture(market === 'CA' ? 'ca-day.json' : 'us-day.json');
  const mapping = loadFixture(market === 'CA' ? 'ca-mapping.json' : 'us-mapping.json');
  const store = new SqliteStore();
  store.createWorkspace({ id: source.workspaceId, realmId: source.realmId, country: source.country, currency: source.currency });
  store.createLocation({ id: source.locationId, workspaceId: source.workspaceId, toastLocationId: `toast-${source.locationId}`, timezone: source.timezone });
  store.saveMapping(source.locationId, mapping);
  store.putEntitlement(source.workspaceId, entitlement ?? { status: 'PAID', syncPaused: false });
  const quickBooks = new FakeQuickBooks();
  const engine = new SyncEngine({ store, quickBooks, clock: () => '2026-09-20T12:00:00.000Z' });
  return { source, mapping, store, quickBooks, engine };
}
