"""Credential-safe official TAGO discovery. Uses a Decoding key with urlencode."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import build_opener, HTTPRedirectHandler
from urllib.error import HTTPError

ROOT = 'https://apis.data.go.kr/1613000/'
ROUTES = 'BusRouteInfoInqireService/'
LOCATIONS = 'BusLcInfoInqireService/'

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = build_opener(NoRedirect)



def read_key():
    # The project-local file takes priority over an older inherited shell key.
    env_file = Path(__file__).resolve().parents[2] / '.env.local'
    if env_file.exists():
        if env_file.stat().st_mode & 0o077:
            raise ValueError('Local env permissions must be 0600')
        for line in env_file.read_text().splitlines():
            if line.startswith('PUBLIC_DATA_SERVICE_KEY='):
                return line.split('=', 1)[1].strip().strip('\"\'')
    return os.environ.get('PUBLIC_DATA_SERVICE_KEY', '')


def call(key, operation, params=None, paged=True):
    records = []
    for page in range(1, 101):
        query = dict(params or {}, serviceKey=key, _type='json')
        if paged:
            query.update(pageNo=page, numOfRows=100)
        # Never print this URL, HTTPError, or response body on an error.
        url = ROOT + operation + '?' + urlencode(query)
        try:
            with OPENER.open(url, timeout=15) as response:
                status = response.status
                payload = json.load(response)
        except HTTPError as error:
            raise ValueError(f'TAGO HTTP {error.code}') from None
        except Exception:
            raise ValueError('TAGO transport or JSON error; check approval and Decoding key') from None
        envelope = payload.get('response', {})
        header = envelope.get('header', {})
        code = str(header.get('resultCode', ''))
        if status != 200 or code != '00':
            safe_code = code if code.isdigit() and len(code) <= 3 else 'unknown'
            raise ValueError(f'TAGO resultCode {safe_code}')
        body = envelope.get('body', {})
        container = body.get('items') or {}
        items = container.get('item', [])
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list) or not all(isinstance(i, dict) for i in items):
            raise ValueError('Invalid TAGO items')
        records.extend(items)
        if not paged or len(records) >= int(body['totalCount']):
            return {'httpStatus': status, 'resultCode': code,
                    'resultMsg': 'NORMAL SERVICE' if str(header.get('resultMsg', '')).rstrip('.').strip() == 'NORMAL SERVICE' else 'OTHER_SUCCESS_MESSAGE',
                    'items': records}
        if not items or int(body.get('pageNo', 0)) != page:
            raise ValueError('Incomplete TAGO pagination')
    raise ValueError('TAGO page limit exceeded')


def main():
    key = read_key()
    if not key:
        raise ValueError('PUBLIC_DATA_SERVICE_KEY is required')
    if '%' in key:
        raise ValueError('Use the Decoding key; urlencode performs encoding once')
    cities = call(key, ROUTES + 'getCtyCodeList', paged=False)
    jeju = [x for x in cities['items'] if '제주' in str(x.get('cityname', '')) or '서귀포' in str(x.get('cityname', ''))]
    evidence = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'authentication': {k: v for k, v in cities.items() if k != 'items'}, 'cities': jeju, 'routes': []}
    for city in jeju:
        city_code = str(city['citycode'])
        found = call(key, ROUTES + 'getRouteNoList', {'cityCode': city_code, 'routeNo': '365'})
        for route in found['items']:
            # Keep all official variants returned by the route-number search.
            params = {'cityCode': city_code, 'routeId': str(route['routeid'])}
            stops = call(key, ROUTES + 'getRouteAcctoThrghSttnList', params)
            entry = {'cityCode': city_code, 'route': route, 'stops': stops}
            try:
                entry['vehicles'] = call(key, LOCATIONS + 'getRouteAcctoBusLcList', params)
            except ValueError as error:
                entry['vehicleError'] = str(error)
            evidence['routes'].append(entry)
    # Allowlist response fields; never write request URLs or echoed credentials.
    route_keys = {'routeid','routeno','routetp','startnodenm','endnodenm'}
    stop_keys = {'nodeid','nodenm','nodeord','gpslati','gpslong','updowncd'}
    vehicle_keys = {'vehicleno','nodeid','nodenm','nodeord','gpslati','gpslong','routenm','routetp'}
    for entry in evidence['routes']:
        entry['route'] = {k:v for k,v in entry['route'].items() if k in route_keys}
        for name, allowed in [('stops',stop_keys),('vehicles',vehicle_keys)]:
            if name in entry:
                entry[name]['items'] = [{k:v for k,v in item.items() if k in allowed} for item in entry[name]['items']]
    evidence['cities'] = [{k:v for k,v in city.items() if k in {'citycode','cityname'}} for city in evidence['cities']]
    encoded = json.dumps(evidence, ensure_ascii=False, indent=2)
    if key in encoded:
        raise ValueError('Response contains credential; refusing output')
    print(encoded)
    if not jeju or not evidence['routes']:
        return 3
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except ValueError as error:
        print(json.dumps({'ok':False,'message':str(error)}), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('{"ok":false,"message":"Unexpected probe failure; details withheld to protect credentials"}', file=sys.stderr)
        sys.exit(1)
