/**
 * Parties: seller identification (BR-CO-26), VAT identifier prefix (BR-CO-09), and German
 * format (IF-VAT-001).
 */
import type { Rule } from '../types.js';
import { blank } from './document.js';

/**
 * Prefixes per BR-CO-09 (ISO 3166-1 alpha-2 plus "EL" for Greece, "1A" Kosovo, "XI" Northern Ireland).
 * Taken from EN16931-CII-validation.xslt 1.3.16.
 */
const VAT_PREFIXES = new Set(
  ('1A AD AE AF AG AI AL AM AN AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BL BJ BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH EL ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XI YE YT ZA ZM ZW').split(' '),
);

/** VAT identifier without whitespace, upper case. */
export function normalizeVatId(vatId: string): string {
  return vatId.replace(/[\s.-]/g, '').toUpperCase();
}

export const PARTY_RULES: readonly Rule[] = [
  {
    id: 'BR-CO-26',
    businessTerm: 'BT-31',
    severity: 'error',
    source: 'EN16931',
    description: 'Seller is identifiable: VAT identifier (BT-31), legal registration number (BT-30), or seller identifier (BT-29).',
    check({ invoice, report }) {
      const s = invoice.seller;
      if (blank(s.vatId) && blank(s.legalRegistration?.id) && blank(s.id)) {
        report({
          path: 'seller.vatId',
          message: `The seller "${s.name}" is not identifiable: neither a VAT identifier (seller.vatId), a legal registration number (seller.legalRegistration.id), nor a seller identifier (seller.id) is given${blank(s.taxNumber) ? '' : ' (the tax number alone is not sufficient under EN 16931)'}.`,
          hint: 'Provide seller.vatId (the usual case). For small businesses without a VAT identifier: seller.legalRegistration { id: "HRB …" } or seller.id (e.g. the seller\'s own supplier number with the customer).',
        });
      }
    },
  },
  {
    id: 'BR-CO-09',
    businessTerm: 'BT-31',
    severity: 'error',
    source: 'EN16931',
    description: 'The VAT identifier of the seller and buyer starts with a country prefix (ISO 3166-1 alpha-2, EL for Greece).',
    check({ invoice, report }) {
      const check = (path: string, businessTerm: string, who: string, vatId: string | undefined): void => {
        if (blank(vatId)) return;
        const n = normalizeVatId(vatId ?? '');
        if (!VAT_PREFIXES.has(n.slice(0, 2))) {
          report({
            path,
            businessTerm,
            message: `The VAT identifier ${who} "${vatId ?? ''}" does not start with a valid country prefix.`,
            hint: 'Provide the VAT identifier with a country code, e.g. "DE123456789" or "ATU12345678" (Greece: "EL").',
          });
        }
      };
      check('seller.vatId', 'BT-31', 'of the seller', invoice.seller.vatId);
      check('buyer.vatId', 'BT-48', 'of the buyer', invoice.buyer.vatId);
    },
  },
  {
    id: 'IF-VAT-001',
    businessTerm: 'BT-31',
    severity: 'error',
    source: 'einvoice',
    description: 'German VAT identifier has the format DE plus 9 digits.',
    check({ invoice, report }) {
      const check = (path: string, businessTerm: string, who: string, vatId: string | undefined): void => {
        if (blank(vatId)) return;
        const n = normalizeVatId(vatId ?? '');
        if (n.startsWith('DE') && !/^DE\d{9}$/.test(n)) {
          report({
            path,
            businessTerm,
            message: `The German VAT identifier ${who} "${vatId ?? ''}" does not have the format DE plus 9 digits.`,
            hint: 'Check the format, e.g. "DE123456789". The tax number (e.g. "93/815/08152") belongs in taxNumber, not in vatId.',
          });
        }
      };
      check('seller.vatId', 'BT-31', 'of the seller', invoice.seller.vatId);
      check('buyer.vatId', 'BT-48', 'of the buyer', invoice.buyer.vatId);
    },
  },
];
