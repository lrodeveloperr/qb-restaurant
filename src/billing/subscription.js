import { invariant } from '../domain/errors.js';

export const PRICE = Object.freeze({ USD: 2900, CAD: 3900 });

export function quoteActiveLocations({ currency, activeLocations, addedLocations = 0 }) {
  invariant(currency === 'USD' || currency === 'CAD', 'UNSUPPORTED_CURRENCY', 'Pricing supports USD and CAD only.');
  invariant(Number.isSafeInteger(activeLocations) && activeLocations >= 0, 'INVALID_LOCATION_COUNT', 'activeLocations must be a non-negative integer.');
  invariant(Number.isSafeInteger(addedLocations) && addedLocations >= 0, 'INVALID_LOCATION_COUNT', 'addedLocations must be a non-negative integer.');
  const unitPriceCents = PRICE[currency];
  return {
    currency,
    unitPriceCents,
    renewalLocationCount: activeLocations + addedLocations,
    renewalTotalCents: (activeLocations + addedLocations) * unitPriceCents,
    addedLocationsProrated: true,
    removedLocationsEffectiveAtRenewal: true,
  };
}
