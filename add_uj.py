import json

uj_raw = [
  {
    "name": "Marian Aleksander Baraniecki",
    "years": "1848–1895",
    "grave": "Kw. D, gr. rodz. Baranieckich i Smoluchowskich",
    "bio": "Matematyk, inicjator powstania Biblioteki Matematyczno-Fizycznej i jej redaktor."
  },
  {
    "name": "Ludwik Antoni Birkenmajer",
    "years": "1855–1929",
    "grave": "Kw. XII b, płd., gr. 8",
    "bio": "Matematyk i fizyk, historyk nauki, zebrał olbrzymi materiał dotyczący Mikołaja Kopernika, rozwiązał jako pierwszy problem znany później jako III Problem Hilberta, członek Akademii Umiejętności i PAU."
  },
  {
    "name": "Jan Blaton",
    "years": "1907–1948",
    "grave": "Kw. XXII a, rząd 1, gr. 3",
    "bio": "Fizyk teoretyk, podał teoretyczne uzasadnienie dla wzbronionego przejścia magnetycznego, dipolowego. Wybitny znawca kinematyki relatywistycznej reakcji jądrowych. Zginął tragicznie w Tatrach."
  },
  {
    "name": "Michał Bobrzyński",
    "years": "1849–1935",
    "grave": "Kw. 45, zach.",
    "bio": "Historyk prawa polskiego i prawa niemieckiego, zasłynął jako autor wielokrotnie wznawianych Dziejów Polski (1879). Jako wiceprezydent Rady Szkolnej Krajowej przyczynił się do rozwoju szkolnictwa w Galicji, namiestnik Galicji (1908–1913), minister ds. Galicji, przewodniczący komisji przygotowującej projekt konstytucji RP."
  },
  {
    "name": "Adam Bochnak",
    "years": "1899–1974",
    "grave": "Kw. Ł płd. po lewej Grzesickiego",
    "bio": "Historyk sztuki, muzealnik, kierownik Muzeum Sztuki UJ, wicedyrektor Państwowych Zbiorów Sztuki na Wawelu, dyrektor Muzeum Narodowego w Krakowie, prorektor UJ, członek PAU."
  },
  {
    "name": "Ludwik Bruner",
    "years": "1871–1913",
    "grave": "Kw. IX",
    "bio": "Fizykochemik, organizator pierwszego na ziemiach polskich Zakładu Chemii Fizycznej, uznawanego za szkołę profesorów chemii."
  },
  {
    "name": "Piotr Burzyński",
    "years": "1819–1879",
    "grave": "Kw. Kb",
    "bio": "Prawnik, historyk prawa francuskiego i prawa polskiego, autor podręcznika polskiego prawa prywatnego (1867, 1871) oraz nieukończonego podręcznika prawa francuskiego."
  },
  {
    "name": "Ignacy Chrzanowski",
    "years": "1866–1940",
    "grave": "Kw. XI a, płn., gr. 8",
    "bio": "Literaturoznawca, autor Historii literatury niepodległej Polski (965–1795). Aresztowany w czasie Sonderaktion Krakau, poniósł śmierć męczeńską w obozie koncentracyjnym w Sachsenhausen. Członek Akademii Umiejętności."
  },
  {
    "name": "Stefania Ciesielska-Borkowska",
    "years": "1889–1966",
    "grave": "Kw. XXXIV, rząd płd., gr. 12",
    "bio": "Romanistka, prekursorka badań hispanistycznych w Krakowie, autorka fundamentalnej monografii Mistycyzm hiszpański na gruncie polskim (1939)."
  },
  {
    "name": "Rafał Józef Czerwiakowski",
    "years": "1743–1816",
    "grave": "Pas 25 wsch., gr. rodz.",
    "bio": "Lekarz, twórca pierwszej w Polsce katedry chirurgii. W czasie powstania kościuszkowskiego naczelny chirurg wojsk polskich. Pierwszy organizator kształcenia chirurgów, wynalazca narzędzi chirurgicznych, zwany ojcem chirurgii polskiej."
  },
  {
    "name": "Ignacy Rafał Czerwiakowski",
    "years": "1808–1882",
    "grave": "Pas 25 wsch., gr. rodz.",
    "bio": "Syn Rafała Józefa, botanik, lekarz, autor pierwszych uniwersyteckich podręczników botaniki w języku polskim, dyrektor Ogrodu Botanicznego, rektor UJ (1862/1863), członek Akademii Umiejętności."
  },
  {
    "name": "Sebastian Czochron",
    "years": "1750–1819",
    "grave": "Kw. La",
    "bio": "Ksiądz, wykładowca prawa kanonicznego. Zorganizował archiwum uniwersyteckie Uniwersytetu Jagiellońskiego."
  },
  {
    "name": "Emilian Czyrniański",
    "years": "1824–1888",
    "grave": "Kw. 16, gr. rodz.",
    "bio": "Chemik, badacz o niezwykłej intuicji – teoretycznie przewidział istnienie elektronów przed ich odkryciem. Rektor UJ (1874–1875), członek Akademii Umiejętności."
  },
  {
    "name": "Lotar Dargun",
    "years": "1853–1893",
    "grave": "Kw. 15",
    "bio": "Wybitny prawnik, pionier nowoczesnych badań etnologicznych i komparatystycznych w historii prawa."
  },
  {
    "name": "Włodzimierz Demetrykiewicz",
    "years": "1859–1937",
    "grave": "Kw. U, rząd płn.-zach., grób po lewej grobowca Schnilzlów",
    "bio": "Archeolog prehistoryczny, konserwator zabytków, organizator studiów archeologicznych na UJ, członek Akademii Umiejętności, dyrektor Muzeum Archeologicznego PAU."
  },
  {
    "name": "Józef Dietl",
    "years": "1804–1878",
    "grave": "Pas 25 wsch.",
    "bio": "Lekarz internista, rektor UJ (1861–1862). Wybitny balneolog, odnowiciel polskich uzdrowisk (Krynica, Szczawnica, Rabka). Pierwszy prezydent Krakowa w dobie autonomii galicyjskiej."
  },
  {
    "name": "Julian Dunajewski",
    "years": "1821–1907",
    "grave": "Kw. 15",
    "bio": "Brat kardynała Albina Dunajewskiego, profesor ekonomii politycznej i skarbowości na Wydziale Prawa UJ, rektor UJ. Poseł do Sejmu Krajowego, wieloletni minister skarbu Austrii, który uzdrowił finanse cesarstwa."
  }
]

with open('Praemissi_Non_Amissi/professors.json', 'r', encoding='utf-8') as f:
    existing = json.load(f)

for p in existing:
    if 'university' not in p:
        p['university'] = 'AGH'

start_id = len(existing) + 1
for i, item in enumerate(uj_raw):
    cur_id = start_id + i
    offset_lat = ((cur_id * 7) % 50 - 25) * 0.00008
    offset_lng = ((cur_id * 13) % 50 - 25) * 0.00010
    base_lat, base_lng = 50.0752, 19.9538

    existing.append({
        'id': cur_id,
        'university': 'UJ',
        'volume': 'UJ — Cmentarz Rakowicki',
        'name': item['name'],
        'years': item['years'],
        'death_info': '',
        'grave_location': item['grave'],
        'cemetery': 'Cmentarz Rakowicki, Kraków',
        'portrait': None,
        'tomb_img': None,
        'all_images': [],
        'biography': item['bio'],
        'lat': round(base_lat + offset_lat, 6),
        'lng': round(base_lng + offset_lng, 6)
    })

with open('Praemissi_Non_Amissi/professors.json', 'w', encoding='utf-8') as f:
    json.dump(existing, f, ensure_ascii=False, indent=2)

js_content = 'const PROFESSORS_DATA = ' + json.dumps(existing, ensure_ascii=False, indent=2) + ';'
with open('Praemissi_Non_Amissi/data.js', 'w', encoding='utf-8') as f:
    f.write(js_content)

print(f'Total professors now: {len(existing)}')
