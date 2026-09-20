import { deepClone } from '../domain/canonical.js';

export class FakeToast {
  constructor(sources = []) {
    this.sources = new Map(sources.map((source) => [this.#key(source.locationId, source.businessDate), deepClone(source)]));
  }

  put(source) {
    this.sources.set(this.#key(source.locationId, source.businessDate), deepClone(source));
  }

  getClosedDay(locationId, businessDate) {
    const source = this.sources.get(this.#key(locationId, businessDate));
    return source ? deepClone(source) : null;
  }

  #key(locationId, businessDate) {
    return `${locationId}|${businessDate}`;
  }
}
