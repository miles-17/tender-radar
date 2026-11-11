// One entry per bank. `kind` picks the extractor:
//   html   - generic link/table scan (src/extract.js extractItems)
//   json   - tender rows embedded as JSON in <script> (Next.js sites)
//   rupali - Rupali Bank's DataTables POST endpoint
// `scope` (optional) narrows the html scan to a CSS selector.
export const SITES = [
  { id: 'nrb', name: 'NRB Bank', url: 'https://www.nrbbankbd.com/forms-downloads/', kind: 'html' },
  { id: 'city', name: 'City Bank', url: 'https://www.citybankplc.com/rfp/request-for-proposal', kind: 'json' },
  { id: 'prime', name: 'Prime Bank', url: 'https://www.primebank.com.bd/tenders', kind: 'html' },
  { id: 'abbl', name: 'AB Bank', url: 'https://abbl.com/rfp/', kind: 'html' },
  { id: 'rupali', name: 'Rupali Bank', url: 'https://rupalibank.com.bd/notice_jquery.php?type=18', kind: 'rupali' },
  { id: 'brac', name: 'BRAC Bank', url: 'https://www.bracbank.com/en/page/e-tender', kind: 'json' },
  { id: 'community', name: 'Community Bank', url: 'https://www.communitybankbd.com/tender/', kind: 'html' },
  { id: 'dbbl', name: 'Dutch-Bangla Bank', url: 'https://www.dutchbanglabank.com/tender/tender.html', kind: 'html' },
  { id: 'ibbl', name: 'Islami Bank', url: 'https://www.islamibankbd.com/tender-notice', kind: 'html' },
  { id: 'jamuna', name: 'Jamuna Bank', url: 'https://jamunabankbd.com/notice-board/', kind: 'html' },
  { id: 'mbl', name: 'Mercantile Bank', url: 'https://www.mblbd.com/tender', kind: 'html' },
  { id: 'onebank', name: 'ONE Bank', url: 'https://www.onebank.com.bd/', kind: 'html' },
  { id: 'sjibl', name: 'Shahjalal Islami Bank', url: 'https://sjiblbd.com/tender.php', kind: 'html' },
  { id: 'sebl', name: 'Southeast Bank', url: 'https://www.southeastbank.com.bd/?page=request_for_proposal', kind: 'html' },
  { id: 'citizens', name: 'Citizens Bank', url: 'https://www.citizensbankbd.com/invitation-tender', kind: 'html' },
  { id: 'ific', name: 'IFIC Bank', url: 'https://ificbank.com.bd/notice', kind: 'html' },
];
