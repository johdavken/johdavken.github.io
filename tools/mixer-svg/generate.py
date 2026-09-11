"""Author three orthographic batch-mixer SVG views, using only the standard library.

Coordinates: x across the machine, z toward the rear, h above the screw feed.
The discharge connection is the origin; the camera matches the extruder study.
"""
from pathlib import Path
from math import sin, cos, radians, tau, pi, atan2
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'images' / 'mixer'
VIEWS = ((0, 'front'), (30, 'intermediate'), (60, 'angled'))
# Assembly positions are in model space, shared by every camera angle.
FRAME_FRONT_Z = -62
FRAME_TOP = 418
COVER_FRONT_Z = FRAME_FRONT_Z + 27
VALVE_CENTERS = (-48, 0, 48)
VALVE_MOUNT_Z = FRAME_FRONT_Z + 12
VALVE_MOUTH_Z = FRAME_FRONT_Z - 18
PALETTES = {
    'ui': {
        'outline': '#445468', 'front': '#313f52', 'side': '#27333f',
        'top': '#3c4b5f', 'edge': '#55677d', 'steel': '#495b70',
        'light': '#65788d', 'dark': '#1b2430', 'window': '#10171f',
        'glass': '#253443', 'material': '#687b8c', 'accent': '#ae8035',
        'blue': '#477f9c', 'hose': '#253040',
    },
    'steel': {
        'outline': '#7c898e', 'front': '#c1c9cb', 'side': '#9ba8ad',
        'top': '#e0e5e3', 'edge': '#a9b6ba', 'steel': '#a4afb1',
        'light': '#dce2df', 'dark': '#5c686e', 'window': '#27343a',
        'glass': '#aebfc4', 'material': '#e8e7dc', 'accent': '#d2a23c',
        'blue': '#378ba6', 'hose': '#626e74',
    },
}


def render(angle, theme, geometry=None):
    a, e = radians(angle), radians(12)
    ca, sa, ce, se = cos(a), sin(a), cos(e), sin(e)
    colors, shapes, bounds = PALETTES[theme], [], []
    prefix = f'mixer-{theme}-{angle}'
    offset = (0, 0, 0)

    def project(p):
        x, z, h = p
        return x * ca + z * sa, x * sa * se - z * ca * se - h * ce

    def polygon(points, tone, part, outline=True, width=.95):
        points = [tuple(p[i] + offset[i] for i in range(3)) for p in points]
        if geometry is not None:
            geometry.append({'part': part, 'points': points})
        xy = [project(p) for p in points]
        bounds.extend(xy)
        d = 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in xy) + ' Z'
        stroke = colors['outline'] if outline else colors[tone]
        shapes.append(f'<path class="mixer__{tone}" data-part="{part}" d="{d}" fill="{colors[tone]}" stroke="{stroke}" stroke-width="{width if outline else .3}" stroke-linejoin="round"/>')

    def group(part, draw, translation=(0, 0, 0)):
        nonlocal offset
        previous = offset
        offset = tuple(previous[i] + translation[i] for i in range(3))
        shapes.append(f'<g data-assembly="{part}">')
        draw()
        shapes.append('</g>')
        offset = previous

    def box(x0,x1,z0,z1,h0,h1,part,tones=('front','side','top')):
        polygon([(x0,z0,h1),(x1,z0,h1),(x1,z1,h1),(x0,z1,h1)],tones[2],part)
        if angle:
            polygon([(x1,z0,h0),(x1,z1,h0),(x1,z1,h1),(x1,z0,h1)],tones[1],part)
        polygon([(x0,z0,h0),(x1,z0,h0),(x1,z0,h1),(x0,z0,h1)],tones[0],part)

    def disc(x,z,h,r,tone,part,outline=True):
        polygon([(x+r*cos(tau*i/48),z,h+r*sin(tau*i/48)) for i in range(48)],tone,part,outline)

    def top_disc(x,z,h,r,tone,part):
        polygon([(x+r*cos(tau*i/48),z+r*sin(tau*i/48),h) for i in range(48)],tone,part)

    def bands(n, visible, shade, points, part):
        # Merge neighboring curved facets with the same flat shade.
        runs=[]
        for i in range(n):
            t=(i+.5)*tau/n
            if not visible(t):
                continue
            tone=shade(t)
            if runs and runs[-1][1]==i and runs[-1][2]==tone:
                runs[-1]=(runs[-1][0],i+1,tone)
            else:
                runs.append((i,i+1,tone))
        for first,last,tone in runs:
            polygon([points(i*tau/n,0) for i in range(first,last+1)] +
                    [points(i*tau/n,1) for i in range(last,first-1,-1)],tone,part,False)

    def barrel(x,z0,z1,h,r,part,cap='steel'):
        bands(48, lambda t: cos(t)*sa*ce+sin(t)*se >= 0,
              lambda t: 'top' if sin(t)>.65 else 'front' if sin(t)>-.35 else 'side',
              lambda t,end:(x+r*cos(t),z0 if end==0 else z1,h+r*sin(t)),part)
        disc(x,z0,h,r,cap,part)

    def cone(x,z,h0,h1,r0,r1,part,accent=False):
        top_disc(x,z,h1,r1,'accent' if accent else 'top',part)
        bands(48,lambda t:cos(t)*sa-sin(t)*ca > -.001,
              lambda t:'accent' if accent else 'top' if cos(t)<-.35 else 'front' if cos(t)<.6 else 'side',
              lambda t,end:(x+(r0 if end==0 else r1)*cos(t),z+(r0 if end==0 else r1)*sin(t),h0 if end==0 else h1),part)

    def bolt(x,z,h,r=2.7):
        polygon([(x+r*cos(tau*i/6),z,h+r*sin(tau*i/6)) for i in range(6)],'light','fastener',False)

    def window(points, part='inspection-window'):
        polygon([(x,-104,h+140) for x,h in points],'window',part)

    def bezier(p0,p1,p2,p3,n=12):
        return [tuple((1-t)**3*p0[j]+3*(1-t)**2*t*p1[j]+3*(1-t)*t*t*p2[j]+t**3*p3[j] for j in (0,1)) for t in [i/n for i in range(n+1)]]

    def pipe(x):
        # Each valve mounts inside the same top crossmember. The mouths are
        # in one row just ahead of its front face, with clearance at both
        # corners even at 60 degrees; the mount ring stays inside the beam.
        start = (x, VALVE_MOUNT_Z, FRAME_TOP + 7)
        end = (x, VALVE_MOUTH_Z, FRAME_TOP - 25)
        dy,dz=end[1]-start[1],end[2]-start[2]
        # Bevel-cut ends are parallel to the beam's front face. Keeping the
        # lip in that plane prevents the mouths turning edge-on at 60°.
        def ring(t,end_index,r=11):
            c=start if end_index==0 else end
            return (c[0]+r*cos(t),c[1],c[2]+r*sin(t))
        # Continuous silhouette beneath the broad shade bands: without it,
        # same-color tube/frame surfaces make the valve look disconnected.
        # The side normal accounts for the oblique cylinder's slope.
        normal_y = (dz/dy)*ca*ce + se
        facing = atan2(normal_y, sa*ce)
        arc = [facing-pi/2 + pi*i/24 for i in range(25)]
        polygon([ring(t,0) for t in arc] + [ring(t,1) for t in reversed(arc)],
                'front','inlet-chute')
        bands(32, lambda t:cos(t)*sa*ce+sin(t)*normal_y>0,
              lambda t:'top' if cos(t)<-.25 else 'front',lambda t,end:ring(t,end),'inlet-chute')
        polygon([ring(tau*i/40,1) for i in range(40)],'edge','inlet-rim')
        polygon([ring(tau*i/40,1,7.5) for i in range(40)],'dark','inlet-opening')

    def rear_frame():
        for x in (-99,99):
            box(x-8,x+8,62,78,32,409,'rear-upright',('side','dark','front'))
        box(-107,107,60,80,399,417,'rear-crossmember')
        box(-106,106,62,78,209,220,'rear-brace',('side','dark','front'))
    group('rear-frame',rear_frame)

    def outlet():
        cone(0,0,0,40,22,22,'outlet-neck')
        cone(0,0,3,10,32,32,'outlet-flange')
        cone(0,0,38,56,24,42,'discharge-transition')
    group('outlet',outlet)

    def base():
        box(-113,113,-67,81,30,40,'base-platform')
        # An open center leaves the discharge throat visible below the pan.
        cone(0,0,40,49,37,37,'discharge-collar')
    group('base',base)

    def chamber():
        barrel(0,COVER_FRONT_Z+17,54,140,77,'mixing-chamber','front')
        box(-85,-73,COVER_FRONT_Z+32,32,133,164,'door-hinge',('steel','side','top'))
        cone(0,5,211,237,25,25,'weigh-discharge-neck')
    group('mixing-chamber',chamber)

    def hopper():
        cone(0,5,233,283,27,67,'weigh-cone')
        cone(0,5,283,314,67,67,'weigh-bowl')
        cone(0,5,308,315,70,70,'weigh-rim',True)
        top_disc(0,5,316,64,'dark','weigh-opening')
        # One quiet mound, avoiding pellet-scale noise in the station view.
        polygon([(-58,-16,317),(-47,-9,326),(-23,4,340),(-6,5,343),(20,3,332),(46,-9,323),(57,-16,317)],'material','batch-material',False)
        for x in (-74,74):
            box(x-7,x+7,-15,27,262,273,'weigh-mount',('steel','side','top'))
        bolt(-72,-16,267,3)
        bolt(72,-16,267,3)
    group('weigh-hopper',hopper)

    def guard():
        # Open framed feed chamber; the photo's clear enclosure is suggested
        # by its rim and mullions, without a transparent overlay muddying it.
        for x in (-72,72):
            box(x-2,x+2,-42,-37,316,378,'feed-guard-post',('edge','side','top'))
        box(-77,77,-48,61,376,383,'feed-guard-lid')
        box(-74,74,-44,-38,317,321,'feed-guard-sill',('edge','side','top'))
    group('feed-guard',guard)

    def door():
        barrel(0,-99,-85,140,81,'inspection-rim','dark')
        barrel(0,-103,-99,140,77,'inspection-cover','steel')
        # The characteristic paired, swept windows leave a solid central web.
        right=bezier((43,40),(64,30),(67,-20),(38,-47)) + bezier((38,-47),(24,-59),(12,-64),(7,-63))[1:] + bezier((7,-63),(13,-13),(20,19),(43,40))[1:]
        left=bezier((-58,17),(-61,-15),(-49,-42),(-21,-55)) + bezier((-21,-55),(-13,-59),(-8,-61),(-6,-62))[1:] + bezier((-6,-62),(-17,-15),(-32,6),(-58,17))[1:]
        window(right)
        window(left)
        # Broad, stationary paddle glimpses stay completely inside the windows.
        polygon([(-49,-104.2,118),(-30,-104.2,119),(-20,-104.2,95),(-35,-104.2,104)],'front','agitator-glimpse',False)
        polygon([(19,-104.2,96),(36,-104.2,107),(44,-104.2,119),(28,-104.2,119)],'front','agitator-glimpse',False)
        disc(0,-104.5,150,6.7,'light','cover-knob')
        disc(0,-104.7,150,2.5,'edge','knob-center',False)
        for degrees in (22,76,132,185,239,292):
            t=radians(degrees)
            bolt(71*cos(t),-104.8,140+71*sin(t),2.8)
        box(-85,-74,-108,-97,147,173,'cover-hinge',('edge','side','top'))
        box(71,83,-108,-98,113,124,'cover-latch',('edge','side','top'))
    # Keep the rim, windows, paddles, knob, hinge and latch together behind
    # the front posts. Translating only the disc would detach its details.
    group('inspection-cover',door,translation=(0,COVER_FRONT_Z+103,0))

    def front_frame():
        # The lower frame widens into folded feet, as in the reference photo.
        for x in (-99,99):
            polygon([(x-9,-62,409),(x+9,-62,409),(x+9,-62,103),(x+16,-62,41),(x-16,-62,41),(x-9,-62,103)],'front','front-upright')
            if angle:
                polygon([(x+9,-62,409),(x+9,-40,409),(x+9,-40,103),(x+16,-40,41),(x+16,-62,41),(x+9,-62,103)],'side','upright-fold')
            for h in (69,364):
                bolt(x,-62.2,h,2.4)
        for x in (-99,99):
            box(x-9,x+9,-60,79,399,417,'upper-side-rail')
        box(-108,108,-63,-40,391,418,'top-crossmember')
        # Simple equipment plate, without reproducing branding or safety text.
        box(57,83,-64,-63,399,411,'identification-plate',('edge','side','top'))
    group('front-frame',front_frame)

    def pneumatics():
        box(-133,-109,-43,-20,204,253,'air-regulator-mount',('side','dark','front'))
        cone(-121,-52,207,244,8,8,'air-filter-bowl')
        cone(-121,-52,201,209,5,8,'filter-drain')
        box(-132,-110,-61,-39,241,252,'air-regulator',('edge','side','top'))
        cone(-121,-51,252,270,7,7,'regulator-knob')
        # Blue control cap is a small identifying accent, as in the photo.
        top_disc(-121,-51,271,7,'blue','regulator-cap')
        barrel(-121,-72,-62,242,9,'pressure-gauge','dark')
        disc(-121,-72.2,242,6,'light','gauge-face')
        polygon([(-121,-72.4,241),(-118,-72.4,246),(-120,-72.4,241)],'dark','gauge-needle',False)
        # A single broad hose curve reads better than multiple thin wires.
        pts=bezier((-122,202),(-146,150),(-131,122),(-103,118))
        polygon([(x,-54,h) for x,h in pts]+[(x+3,-54,h+1) for x,h in reversed(pts)],'hose','air-hose',False)
    group('pneumatics',pneumatics)
    group('inlet-chutes',lambda:[pipe(x) for x in VALVE_CENTERS])

    xmin,xmax=min(x for x,y in bounds)-12,max(x for x,y in bounds)+12
    # Shared vertical extent preserves physical scale and the outlet anchor.
    ymin,height=-452,469
    width=xmax-xmin
    metadata=f'data-yaw="{angle}" data-elevation="12" data-outlet-x="0" data-outlet-y="0" data-inlet-x="{project((0,0,418))[0]:.2f}" data-inlet-y="{project((0,0,418))[1]:.2f}"'
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{xmin:.2f} {ymin} {width:.2f} {height}" width="{width:.2f}" height="{height}" role="img" aria-labelledby="{prefix}-title {prefix}-desc" {metadata}>
<title id="{prefix}-title">Batch mixer — {angle} degree view</title>
<desc id="{prefix}-desc">Framed batch mixer with inlet chutes, a weighing hopper with an amber rim, a cylindrical mixing chamber, circular inspection cover with two swept windows, pneumatic regulator and bottom discharge. Simplified orthographic illustration based on the supplied workplace photograph; unseen geometry is inferred.</desc>
{chr(10).join(shapes)}
</svg>'''
    ET.fromstring(svg)
    return svg,width,height


def contact_sheet(views,theme):
    dark=theme=='ui'
    bg,card,stroke,fg,muted=('#10151c','#161e28','#2e3b4d','#e5eaf1','#8494a7') if dark else ('#f1f4f3','#fff','#d9e0de','#253239','#627176')
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="850" viewBox="0 0 1440 850"><rect width="1440" height="850" fill="{bg}"/>',
         f'<g font-family="Arial, sans-serif" fill="{fg}"><text x="54" y="53" font-size="12" letter-spacing="2.5">BATCH MIXER / {"STATION PALETTE" if dark else "NEUTRAL STEEL"}</text><text x="54" y="100" font-size="34">Three views of the batch mixer</text><text x="54" y="134" font-size="17" fill="{muted}">Open frame · weighing hopper · inspection cover · discharge connection</text></g>']
    for i,(angle,name) in enumerate(VIEWS):
        x=42+i*456
        svg,w,h=views[name]
        out.append(f'<rect x="{x}" y="173" width="432" height="634" rx="16" fill="{card}" stroke="{stroke}"/>')
        scale=440/h
        nested=svg.replace(f'width="{w:.2f}" height="{h}"',f'x="{x+(432-w*scale)/2:.2f}" y="197" width="{w*scale:.2f}" height="{h*scale:.2f}"',1)
        out.append(nested)
        # Same artwork at UI scale, with unique accessible IDs per instance.
        small=svg.replace('mixer-'+theme+'-'+str(angle),'small-mixer-'+theme+'-'+str(angle))
        small=small.replace(f'width="{w:.2f}" height="{h}"',f'x="{x+330-w*130/h/2:.2f}" y="655" width="{w*130/h:.2f}" height="130"',1)
        out.append(small)
        label={0:'Front',30:'Photo angle',60:'Outer angle'}[angle]
        out.append(f'<g font-family="Arial, sans-serif" fill="{fg}"><text x="{x+26}" y="702" font-size="22">{label} · {angle}°</text><text x="{x+26}" y="730" font-size="14" fill="{muted}">Transparent SVG</text><text x="{x+26}" y="765" font-size="12" fill="{muted}">UI size shown at right →</text></g>')
    out.append('</svg>')
    return '\n'.join(out)+'\n'


def arrangements():
    """Review compositions only; existing station artwork is read, never edited."""
    ns='http://www.w3.org/2000/svg'
    ET.register_namespace('',ns)
    def nested(path,scale):
        root=ET.fromstring(path.read_text())
        x,y,w,h=map(float,root.attrib['viewBox'].split())
        root.set('x',f'{x*scale:.2f}')
        root.set('y',f'{y*scale:.2f}')
        root.set('width',f'{w*scale:.2f}')
        root.set('height',f'{h*scale:.2f}')
        return ET.tostring(root,encoding='unicode')
    for count,angles in ((1,[0]),(3,[-30,0,30]),(5,[-60,-30,0,30,60])):
        parts=[f'<svg xmlns="{ns}" width="1400" height="440" viewBox="0 0 1400 440" role="img" aria-labelledby="layers-{count}-title"><title id="layers-{count}-title">{count} layer mixer and screw arrangement</title>',
               '<rect width="1400" height="440" fill="#10151c"/>']
        names={0:'front',30:'intermediate',60:'angled'}
        for index,angle in enumerate(angles):
            x=700+(index-(count-1)/2)*263
            name=names[abs(angle)]
            parts.append(f'<g transform="translate({x} 273) scale({-1 if angle<0 else 1} 1)">')
            parts.append(nested(ROOT/'station'/'assets'/f'extruder-{name}.svg',1))
            parts.append(nested(OUT/f'mixer-{name}.svg',.42))
            parts.append('</g>')
            parts.append(f'<text x="{x}" y="418" text-anchor="middle" fill="#8494a7" font-family="Arial, sans-serif" font-size="14">Layer {chr(65+index)} · {angle}°</text>')
        parts.append('</svg>')
        text='\n'.join(parts)
        # Repeated views occur only as ±yaw pairs; prefix entire nested roots.
        root=ET.fromstring(text)
        for index,child in enumerate(root.findall(f'.//{{{ns}}}svg')):
            for elem in child.iter():
                if 'id' in elem.attrib:
                    elem.set('id',f'instance-{index}-'+elem.attrib['id'])
                if 'aria-labelledby' in elem.attrib:
                    elem.set('aria-labelledby',' '.join(f'instance-{index}-'+v for v in elem.attrib['aria-labelledby'].split()))
        (OUT/f'layers-{count}.svg').write_text(ET.tostring(root,encoding='unicode')+'\n')


if __name__=='__main__':
    for theme in PALETTES:
        folder=OUT if theme=='ui' else OUT/'steel'
        folder.mkdir(parents=True,exist_ok=True)
        views={}
        for angle,name in VIEWS:
            svg,w,h=render(angle,theme)
            (folder/f'mixer-{name}.svg').write_text(svg+'\n')
            views[name]=(svg,w,h)
        (folder/'preview.svg').write_text(contact_sheet(views,theme))
    arrangements()
    print('Generated 0°, 30°, 60° batch mixers in station and steel palettes:',OUT)
