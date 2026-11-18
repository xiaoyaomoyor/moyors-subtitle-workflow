"""Independent, non-rendering timeline review notes; missing links are allowed."""
import re

SCHEMA = 'msw.review.v1'
LIMIT = 10000


def validate(value):
    def text(v, limit):
        return isinstance(v, str) and len(v.encode('utf-16-le', errors='surrogatepass')) // 2 <= limit

    def identity(v):
        return text(v, 160) and bool(v.strip())

    def time(v):
        return type(v) is int and 0 <= v <= 9007199254740991

    def fail():
        raise ValueError('复核标记格式无效')

    if (not isinstance(value, dict) or value.get('schema') != SCHEMA
            or not isinstance(value.get('items'), list) or len(value['items']) > LIMIT):
        fail()
    ids = set()
    for item in value['items']:
        if (not isinstance(item, dict) or not identity(item.get('id')) or item['id'] in ids
                or not time(item.get('start_ms'))
                or 'end_ms' in item and (not time(item['end_ms']) or item['end_ms'] <= item['start_ms'])
                or not text(item.get('name'), 120) or not text(item.get('note'), 2000)
                or not isinstance(item.get('color'), str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', item['color'])
                or 'text_color' in item and (not isinstance(item['text_color'], str)
                    or not re.fullmatch(r'#[0-9a-fA-F]{6}', item['text_color']))
                or item.get('status') not in ('pending', 'resolved')
                or 'track_id' in item and not identity(item['track_id'])):
            fail()
        links = item.get('cue_ids', [])
        if not isinstance(links, list) or len(links) > LIMIT or not all(map(identity, links)) or len(set(links)) != len(links):
            fail()
        ids.add(item['id'])
    return value
