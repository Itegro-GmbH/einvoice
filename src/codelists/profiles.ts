import type { Profile } from '../model/input.js';

/**
 * BT-24 Specification identifier per profile.
 * Factur-X 1.0 / ZUGFeRD 2.x URNs; XRechnung 3.0 (KoSIT).
 */
export const PROFILE_URNS: Readonly<Record<Profile, string>> = {
  basic: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
  en16931: 'urn:cen.eu:en16931:2017',
  extended: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
  xrechnung: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
};
