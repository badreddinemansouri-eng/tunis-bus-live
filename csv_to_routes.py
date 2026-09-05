import csv
import json
from collections import defaultdict

def parse_routes(csv_path, output_path):
    routes = defaultdict(lambda: {"aller": [], "retour": []})
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        next(reader)  # skip header
        
        for row in reader:
            if len(row) < 5:
                continue
            route_id_raw = row[0].strip()
            stop_name = row[2].strip()
            try:
                lng = float(row[3].replace(',', '.'))
                lat = float(row[4].replace(',', '.'))
            except ValueError:
                continue
            
            if 'Retour' in route_id_raw or '(Retour)' in route_id_raw:
                direction = 'retour'
                base_id = route_id_raw.split('(')[0].split('Retour')[0].strip()
                if not base_id:
                    base_id = route_id_raw.split('(')[0].strip()
                base_id = base_id.replace(' (Retour)', '').strip()
            else:
                direction = 'aller'
                base_id = route_id_raw.split('(')[0].strip()
                if not base_id:
                    base_id = route_id_raw
            base_id = base_id.replace(' (Retour)', '').strip()
            
            routes[base_id][direction].append({
                "name": stop_name,
                "lat": lat,
                "lng": lng
            })
    
    result = []
    for route_id, dirs in routes.items():
        if not dirs['aller'] and not dirs['retour']:
            continue
        all_stops = []
        if dirs['aller']:
            all_stops.extend(dirs['aller'])
        if dirs['retour']:
            all_stops.extend(dirs['retour'])
        result.append({
            "id": route_id,
            "name": f"Ligne {route_id}",
            "stops": all_stops,
            "aller": dirs['aller'],
            "retour": dirs['retour']
        })
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("const routesData = ")
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write(";\n")
    
    print(f"✅ Generated {len(result)} routes in {output_path}")

if __name__ == "__main__":
    # Change the CSV filename if yours is different
    parse_routes('d503239c-f821-4a83-b954-425dc5bb16bf_7bc4394f-7a19-4af9-9bd6-ea1a777473c7.csv', 'routes.js')
