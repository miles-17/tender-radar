// One entry per bank. `kind` picks the extractor:
//   html   - generic link/table scan (src/extract.js extractItems)
//   json   - tender rows embedded as JSON in <script> (Next.js sites)
//   rupali - Rupali Bank's DataTables POST endpoint
//   auto   - embedded JSON and HTML scan, merged (same as sites added from the dashboard)
//   egp    - e-GP national portal, all ministries (section 'gov')
//   bppa   - BPPA newspaper advertisements, per ministry (section 'gov')
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
  { id: 'aibl', name: 'Al-Arafah Islami Bank', url: 'https://www.aibl.com.bd/tender/', kind: 'auto' },
  { id: 'bankasia', name: 'Bank Asia', url: 'https://www.bankasia-bd.com/home/tender', kind: 'auto' },
  { id: 'bgcb', name: 'Bengal Commercial Bank', url: 'https://www.bgcb.com.bd/e-tender', kind: 'auto' },
  { id: 'ebl', name: 'Eastern Bank', url: 'https://www.ebl.com.bd/ICT-Tender-Notice', kind: 'auto' },
  { id: 'exim', name: 'EXIM Bank', url: 'https://www.eximbankbd.com/media/tender', kind: 'auto' },
  { id: 'fsibl', name: 'First Security Islami Bank', url: 'https://fsibplc.com/tender.php', kind: 'auto' },
  { id: 'icbib', name: 'ICB Islamic Bank', url: 'https://icbislamic-bd.com/tenders/', kind: 'auto' },
  { id: 'meghna', name: 'Meghna Bank', url: 'https://www.meghnabank.com.bd/notice-board', kind: 'auto' },
  { id: 'midland', name: 'Midland Bank', url: 'https://www.midlandbankbd.net/tender/', kind: 'auto' },
  { id: 'modhumoti', name: 'Modhumoti Bank', url: 'https://www.modhumotibankplc.com/tender/', kind: 'auto' },
  { id: 'nbl', name: 'National Bank', url: 'https://www.nblbd.com/tender-auction', kind: 'auto' },
  { id: 'ncc', name: 'NCC Bank', url: 'https://www.nccbank.com.bd/NccbTender', kind: 'auto' },
  { id: 'nrbc', name: 'NRBC Bank', url: 'https://www.nrbcommercialbank.com/Tender', kind: 'auto' },
  { id: 'premier', name: 'Premier Bank', url: 'https://thepremierbankplc.com/procurement/', kind: 'auto' },
  { id: 'sbac', name: 'SBAC Bank', url: 'https://www.sbacbank.com/e-tender', kind: 'auto' },
  { id: 'sibl', name: 'Social Islami Bank', url: 'https://www.siblbd.com/media', kind: 'auto' },
  { id: 'stdislami', name: 'Standard Islami Bank', url: 'https://www.standardbankbd.com/en/page/dynamic-list/tender', kind: 'auto' },
  { id: 'trust', name: 'Trust Bank', url: 'https://www.tblbd.com/tenders/', kind: 'auto' },
  { id: 'union', name: 'Union Bank', url: 'https://unionbank.com.bd/tender-notice-', kind: 'auto' },
  { id: 'uttara', name: 'Uttara Bank', url: 'https://www.uttarabank-bd.com/tender', kind: 'auto' },
  // Ministries & departments: all government procuring entities, tagged by ministry/division.
  { id: 'egp', name: 'e-GP (all ministries)', url: 'https://www.eprocure.gov.bd/resources/common/AllTenders.jsp?h=t', kind: 'egp', section: 'gov' },
  { id: 'bppa', name: 'BPPA advertisements', url: 'https://www.bppa.gov.bd/advertisement-notices.html', kind: 'bppa', section: 'gov' },
];
