"""Place the corrected blender masters on the matching flat-shaded extruders.

All connections use the assets' declared anchors. Outputs are standalone SVGs
containing the source vector geometry, with no image links or bitmap layers.
"""
from copy import deepcopy
from pathlib import Path
import math
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'images' / 'mixer-extruder'
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
BLENDER_SCALE = .42
VIEWS = ((0, 'front'), (30, 'intermediate'), (60, 'angled'))


def element(tag, attrs=None, text=None):
    node = ET.Element(f'{{{NS}}}{tag}', attrs or {})
    node.text = text
    return node


def instance(source, prefix, attrs=None):
    """Copy a drawing into a group with unique IDs, retaining vector styles."""
    group = element('g', attrs)
    group.extend(deepcopy(list(source)))
    ids = {node.attrib['id']: f'{prefix}-{node.attrib["id"]}'
           for node in group.iter() if 'id' in node.attrib}
    for node in group.iter():
        for key, value in list(node.attrib.items()):
            if key == 'id':
                value = ids[value]
            elif key in ('aria-labelledby', 'aria-describedby'):
                value = ' '.join(ids.get(token, token) for token in value.split())
            elif value.startswith('#') and value[1:] in ids:
                value = '#' + ids[value[1:]]
            else:
                for old, new in ids.items():
                    value = value.replace(f'url(#{old})', f'url(#{new})')
            node.set(key, value)
    return group


def save(name, root):
    ET.indent(root, space='  ')
    (OUT / name).write_text(ET.tostring(root, encoding='unicode') + '\n')


def assemble():
    sources = {}
    for angle, name in VIEWS:
        blender = ET.parse(ROOT/'images'/'mixer'/f'mixer-{name}.svg').getroot()
        extruder = ET.parse(ROOT/'station'/'assets'/f'extruder-{name}.svg').getroot()
        assert int(blender.attrib['data-yaw']) == int(extruder.attrib['data-yaw']) == angle
        assert float(blender.attrib['data-outlet-x']) == float(blender.attrib['data-outlet-y']) == 0
        assert float(extruder.attrib['data-feed-x']) == float(extruder.attrib['data-feed-y']) == 0
        boxes = [list(map(float, extruder.attrib['viewBox'].split())),
                 [v*BLENDER_SCALE for v in map(float, blender.attrib['viewBox'].split())]]
        sources[name] = (angle, blender, extruder, boxes)

    top = math.floor(min(box[1] for *_, boxes in sources.values() for box in boxes))-6
    bottom = math.ceil(max(box[1]+box[3] for *_, boxes in sources.values() for box in boxes))+6
    height = bottom-top
    drawings = {}
    for name, (angle, blender, extruder, boxes) in sources.items():
        left = math.floor(min(box[0] for box in boxes))-6
        right = math.ceil(max(box[0]+box[2] for box in boxes))+6
        title = f'assembly-{name}-title'
        desc = f'assembly-{name}-desc'
        root = element('svg', {
            'viewBox': f'{left} {top} {right-left} {height}',
            'width': str(right-left), 'height': str(height),
            'role': 'img', 'aria-labelledby': f'{title} {desc}',
            'data-yaw': str(angle), 'data-connection-x': '0', 'data-connection-y': '0',
            'data-inlet-x': blender.attrib['data-inlet-x'],
            'data-inlet-y': f'{float(blender.attrib["data-inlet-y"])*BLENDER_SCALE:.2f}',
            'data-outlet-x': extruder.attrib['data-outlet-x'],
            'data-outlet-y': extruder.attrib['data-outlet-y'],
        })
        root.append(element('title', {'id': title}, f'Blender and extruder — {angle}°'))
        root.append(element('desc', {'id': desc},
            'Corrected batch blender mounted on its matching extruder, with aligned discharge and feed connections, flat blue-gray shading, and a transparent background.'))
        root.append(instance(extruder, f'{name}-extruder', {'data-component': 'extruder'}))
        root.append(instance(blender, f'{name}-blender', {
            'data-component': 'blender', 'transform': f'scale({BLENDER_SCALE})'}))
        save(f'mixer-extruder-{name}.svg', root)
        drawings[name] = root

    # Three equal-height views, at one common physical scale.
    sheet = element('svg', {'viewBox': '0 0 1440 820', 'width': '1440', 'height': '820'})
    sheet.append(element('rect', {'width': '1440', 'height': '820', 'fill': '#10151c'}))
    for y, size, text in ((54, 12, 'BLENDER + EXTRUDER / COMPLETE ASSEMBLIES'),
                          (104, 34, 'Three matched views, ready for the UI'),
                          (139, 17, 'Aligned connections · matching angles · flat blue-gray shading')):
        sheet.append(element('text', {'x':'54','y':str(y),'fill':'#e5eaf1' if size==34 else '#8494a7',
                                     'font-family':'Arial, sans-serif','font-size':str(size)},text))
    for index, (angle, name) in enumerate(VIEWS):
        x = 42 + index*456
        sheet.append(element('rect', {'x':str(x),'y':'174','width':'432','height':'602','rx':'16',
                                     'fill':'#161e28','stroke':'#2e3b4d'}))
        box = list(map(float, drawings[name].attrib['viewBox'].split()))
        scale = min(388/box[2], 495/box[3])
        dx = x+216-(box[0]+box[2]/2)*scale
        dy = 192-box[1]*scale
        sheet.append(instance(drawings[name], f'sheet-{name}', {'transform':f'translate({dx:.3f} {dy:.3f}) scale({scale:.5f})'}))
        sheet.append(element('text', {'x':str(x+25),'y':'722','fill':'#e5eaf1','font-family':'Arial, sans-serif','font-size':'22'},
                                     f'{"Front" if angle==0 else "Intermediate" if angle==30 else "Outer angle"} · {angle}°'))
        sheet.append(element('text', {'x':str(x+25),'y':'751','fill':'#8494a7','font-family':'Arial, sans-serif','font-size':'14'}, 'Blender mounted on extruder'))
    save('preview.svg', sheet)

    names = {angle:name for angle,name in VIEWS}
    for count, angles in ((1,[0]), (3,[-30,0,30]), (5,[-60,-30,0,30,60])):
        sheet = element('svg', {'viewBox':'0 0 1400 430','width':'1400','height':'430',
                                'role':'img','aria-label':f'{count} complete blender and extruder assemblies'})
        sheet.append(element('rect', {'width':'1400','height':'430','fill':'#10151c'}))
        for index, angle in enumerate(angles):
            x = 700+(index-(count-1)/2)*263
            sheet.append(instance(drawings[names[abs(angle)]], f'layer-{count}-{index}', {
                'transform':f'translate({x} 265) scale({-1 if angle<0 else 1} 1)'}))
            sheet.append(element('text', {'x':str(x),'y':'412','fill':'#8494a7','font-family':'Arial, sans-serif',
                                         'font-size':'14','text-anchor':'middle'}, f'Layer {chr(65+index)} · {angle}°'))
        save(f'layers-{count}.svg', sheet)
    print('Generated three complete blender/extruder SVGs and 1/3/5-layer previews:', OUT)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    assemble()
