// Local embedding model (bge-small-en-v1.5, ~34 MB, CPU) scores each tender
// against prototype descriptions of software work vs IT hardware vs other.
import { pipeline, env } from '@huggingface/transformers';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

env.cacheDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'models');
const MODEL = 'Xenova/bge-small-en-v1.5';

const PROTOTYPES = {
  software: [
    'custom software development and implementation',
    'development of web application and mobile app',
    'website design, redesign and development',
    'implementation of software solution, system integration and API development',
    'core banking system, loan origination system, ERP, CRM software',
    'call center solution, contact center software, chatbot',
    'digital banking platform, internet banking, mobile banking app',
    'software license, subscription and support service renewal',
    'cyber security assessment, VAPT, penetration testing, audit tools',
    'data analytics, business intelligence, data warehouse, AI solution',
    'monitoring system, automation software, workflow management system',
    'IT consultancy, PCI DSS compliance, ISO 27001 consulting',
    'collection and recovery solution, supply chain financing solution, trade finance solution',
    'mobile financial services platform, payment gateway, SoftPOS, QR payment solution',
    'centralized monitoring system, queue management system, document management system',
    'web application firewall, threat intelligence, SIEM, endpoint security solution',
    'database license and virtualization platform implementation',
  ],
  it: [
    'supply of network switches, routers and firewall hardware',
    'procurement of desktop computers, laptops, printers and servers',
    'supply of ATM, CRM, POS terminals and card printers',
    'CCTV cameras and security surveillance equipment',
    'data center UPS, precision air conditioning and power',
    'local area networking LAN cabling works',
  ],
  other: [
    'civil construction, renovation and interior decoration works',
    'printing and supply of calendar, diary and stationery',
    'supply of furniture, air conditioner, generator and vehicles',
    'auction notice, sale of property or vehicles',
    'cash carrying, security guard, cleaning and outsourced manpower',
    'annual general meeting notice, dividend, financial report, policy',
    'interest rates, schedule of charges, account opening forms',
    'promotional items, gifts, advertising and event management',
  ],
};

// Keyword nudges for very short / acronym-heavy titles the model can miss.
const STRONG_SW_KW = /\b(software|solutions?|platform|web ?site|web portal|apps?|application|aml|temenos|transact|t24|finacle|flexcube|e-?tendering|implementation of [\w -]{0,40}system)\b/i;
// Physical goods: lower software relevance.
const HW_KW = /\b(units?|machines?|modems?|devices?|printers?|scanners?|servers?|laptops?|desktops?|terminals?|equipment'?s?|hardware|spare parts?)\b/i;
const SOFTWARE_KW = /\b(portal|erp|crm|api|integration|development|digital|automation|saas|cloud|cyber|vapt|siem|database|analytics|chatbot|ai|ml|module)\b/i;
// Last group: government works and goods (e-GP / BPPA).
const NON_SW_KW = /\b(printing|calendar|diary|furniture|renovation|interior|civil|generator|vehicle|car|tires?|stationery|paper|auction|agm|toilet|cable|sticker|vrf|chiller|air ?condition\w*|ac|branch|premises|signboard|stamp|water|fire|lift|elevator|construction|repair\w*|re-?excavation|excavation|containers?|garbage|waste|roads?|bridges?|culverts?|drains?|drainage|pavement|embankment|dredging|boundary|walls?|buildings?|pond|canal|tubewell|medicines?|drugs?|seeds?|fertili[sz]ers?|uniforms?|rice|wheat|fuel|lubricants?)\b/i;

// Tender boilerplate carries no topic; strip it so the subject drives the embedding.
const BOILERPLATE = [
  /[,.]?\s*date of submission\s*(?::|on or before|is)[\s\S]*$/i, /\(except regular holidays\)[\s\S]*$/i,
  /\b(?:request for (?:quotation|proposal|information)|expression of interest|notice inviting tender|invitation for (?:tender|quotation|bids?)|sealed quotations? (?:are|is) invited for|tender notice|tender schedules?|corrigendum|addendum|re-?tender)\b/gi,
  /\b(?:request for )?submission of (?:price |financial )?(?:proposal|offer)s?\b/gi,
  /\b(?:financial|price) (?:offer|proposal)\b/gi,
  /\b(?:rfq|rfp|rfi|eoi|ltm|otm|tender|quotation|notice)\b/gi,
  /\b(?:notice for )?(?:time )?extension(?: of date)?(?: of submission)?(?: of)?\b/gi,
  /\b(?:supply(?:ing)?|installation|implementation|configuration|migration|deployment|commissioning|testing|upgradation|procurement|purchas(?:e|ing)|amendment)\b,?/gi,
  /\bfor (?:the )?(?:[\w&'’.-]+ ){0,3}(?:bank|plc|limited|ltd)\b\.?/gi,
  /\b[\w&'’-]+ bank (?:plc|limited|ltd)\b\.?/gi,
  /[()\-–_:“”"]+/g,
];
export function topic(title) {
  let t = title;
  for (const re of BOILERPLATE) t = t.replace(re, ' ');
  return t.replace(/\s+/g, ' ').trim().replace(/^(?:for|of|on|regarding)\s+/i, '').replace(/\s+(?:of|for)$/i, '');
}

// Minimum cosine similarity to a software prototype to count as software at all.
const MIN_SOFTWARE_SIM = 0.6;

let extractor;
let protoVecs;

async function embed(texts) {
  extractor ??= await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  const out = await extractor(texts, { pooling: 'mean', normalize: true });
  const dim = out.dims[1];
  return texts.map((_, i) => out.data.slice(i * dim, (i + 1) * dim));
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function prototypes() {
  if (!protoVecs) {
    protoVecs = {};
    for (const [k, texts] of Object.entries(PROTOTYPES)) protoVecs[k] = await embed(texts);
  }
  return protoVecs;
}

export async function embedQuery(text) {
  // bge models expect this prefix on short retrieval queries.
  return (await embed([`Represent this sentence for searching relevant passages: ${text}`]))[0];
}

/**
 * @param {{title: string}[]} items
 * @returns {Promise<{category: string, score: number, vec: Float32Array}[]>}
 */
export async function classify(items) {
  const protos = await prototypes();
  const results = [];
  for (let i = 0; i < items.length; i += 32) {
    const batch = items.slice(i, i + 32);
    const topics = batch.map((it) => topic(it.title));
    const vecs = await embed(topics.map((t, j) => t || batch[j].title));
    batch.forEach((it, j) => {
      const v = vecs[j];
      const sim = Object.fromEntries(Object.entries(protos).map(([k, ps]) => [k, Math.max(...ps.map((p) => dot(p, v)))]));
      // Saying "software" outright beats incidental words ("Software for Water Supply Billing").
      const nonSw = NON_SW_KW.test(it.title) && !/\bsoftware\b/i.test(it.title);
      if (STRONG_SW_KW.test(it.title) && !nonSw) sim.software += 0.06;
      else if (SOFTWARE_KW.test(it.title)) sim.software += 0.03;
      if (nonSw) sim.software -= 0.05;
      if (HW_KW.test(it.title) && !/\bsoftware\b/i.test(it.title)) sim.software -= 0.04;
      let category = Object.keys(sim).reduce((a, b) => (sim[a] >= sim[b] ? a : b));
      // Nothing left after stripping boilerplate ("Invitation for Tender"): no topic to judge.
      if (topics[j].split(/\s+/).filter((w) => /[a-z]{3}/i.test(w)).length < 2) category = 'other';
      const strong = STRONG_SW_KW.test(it.title);
      if (strong && sim.software >= MIN_SOFTWARE_SIM - 0.1 && sim.software >= Math.max(sim.it, sim.other)) category = 'software';
      else if (category === 'software' && sim.software < MIN_SOFTWARE_SIM) category = sim.it >= sim.other ? 'it' : 'other';
      // Relevance: software similarity relative to the best competing class, mapped to 0..1.
      const margin = sim.software - Math.max(sim.it, sim.other);
      let score = Math.min(1, Math.max(0, 0.5 + margin * 5));
      if (category !== 'software') score = Math.min(score, 0.49);
      results.push({ category, score: Math.round(score * 1000) / 1000, vec: v });
    });
  }
  return results;
}
