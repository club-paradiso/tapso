"""Synthetic credential-safety and discovery tests; no network access."""
import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
import probe

class ProbeTests(unittest.TestCase):
    def test_decoding_key_is_encoded_once(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return b'{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},"body":{"items":"","totalCount":0}}}'
        with patch.object(probe.OPENER, 'open', return_value=Response()) as request:
            result = probe.call('synthetic+key/=', probe.ROUTES + 'getCtyCodeList', paged=False)
        from urllib.parse import urlsplit, parse_qs
        query = parse_qs(urlsplit(request.call_args.args[0]).query)
        self.assertEqual(query['serviceKey'], ['synthetic+key/='])
        self.assertEqual(result['resultMsg'], 'NORMAL SERVICE')

    def test_only_returned_identifiers_are_used_and_key_is_not_printed(self):
        calls = []
        def fake_call(key, operation, params=None, paged=True):
            calls.append((operation,params))
            if operation.endswith('getCtyCodeList'): items = [{'citycode':999,'cityname':'제주 Synthetic'}]
            elif operation.endswith('getRouteNoList'): items = [{'routeid':'SYNTHETIC_R','routeno':365}]
            else: items = []
            return {'httpStatus':200,'resultCode':'00','resultMsg':'NORMAL SERVICE','items':items}
        output = io.StringIO()
        with patch.object(probe,'read_key',return_value='synthetic-private-key'), patch.object(probe,'call',side_effect=fake_call), redirect_stdout(output):
            self.assertEqual(probe.main(),0)
        self.assertEqual(calls[2][1],{'cityCode':'999','routeId':'SYNTHETIC_R'})
        self.assertEqual(calls[3][1],calls[2][1])
        self.assertNotIn('synthetic-private-key',output.getvalue())

    def test_transport_exception_details_are_withheld(self):
        with patch.object(probe.OPENER,'open',side_effect=RuntimeError('secret-in-url')):
            with self.assertRaises(ValueError) as error:
                probe.call('synthetic-key',probe.ROUTES+'getCtyCodeList')
        self.assertNotIn('secret-in-url',str(error.exception))

if __name__ == '__main__': unittest.main()
