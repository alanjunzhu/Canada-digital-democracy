// House of Commons member XML -> person + mp_term rows.
// Deliberately dependency-free: the XML is flat and regular enough that a
// tolerant tag reader beats adding a parser dependency for one file.
import { SOURCES } from '../config/sources.mjs';
import { fetchText } from '../lib/http.mjs';
import { splitPersonName } from '../normalize/names.mjs';

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};

export function parseMembersXml(xml, parliament) {
  const blocks = xml.match(/<MemberOfParliament>[\s\S]*?<\/MemberOfParliament>/gi) || [];
  const persons = new Map();
  const terms = [];
  for (const b of blocks) {
    const given = tag(b, 'PersonOfficialFirstName');
    const surname = tag(b, 'PersonOfficialLastName');
    const riding = tag(b, 'ConstituencyName');
    if (!surname || !riding) continue;
    const display = `${given} ${surname}`.trim();
    const person_id = `${surname}|${given}|${riding}`.toLowerCase().replace(/\s+/g, '-');
    persons.set(person_id, { person_id, display_name: display, given_name: given, surname });
    terms.push({
      mp_term_id: `${person_id}@${parliament}`,
      person_id, parliament, riding,
      province: tag(b, 'ConstituencyProvinceTerritoryName'),
      caucus: tag(b, 'CaucusShortName'),
      start_date: (tag(b, 'FromDateTime') || '').slice(0, 10),
      end_date: (tag(b, 'ToDateTime') || '').slice(0, 10) || null,
      given_name: given, surname,
    });
  }
  return { persons: [...persons.values()], terms };
}

export async function fetchMembers(parliament, { cacheDir = 'data/raw' } = {}) {
  const url = parliament ? SOURCES.members.byParliamentXml(parliament) : SOURCES.members.currentXml;
  const xml = await fetchText(url, { cachePath: `${cacheDir}/members-${parliament || 'current'}.xml` });
  return parseMembersXml(xml, parliament);
}
