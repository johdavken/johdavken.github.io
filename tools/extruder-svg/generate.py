"""Generate editable, orthographic SVG extruder views. Python standard library only."""
from pathlib import Path
import math
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'images' / 'extruder'
OUT.mkdir(parents=True, exist_ok=True)

# The machine's proportion, decided here and nowhere downstream. The model is
# authored in (x = width, z = length, h = height) and reshaped before it is
# projected: the cross-section grows a little everywhere, the barrel ahead of
# the feed flange grows more, and nothing behind the flange changes length.
# Station places the machine by its feed flange, so a fixed rear keeps the
# motor end - the outer end of every turned machine - exactly where it was
# while the die end reaches further in. Feet and readouts follow the feet.
SECTION_SCALE = 1.15   # x and h, the whole length of the machine
BARREL_STRETCH = 1.30  # z, only ahead of the feed flange
BARREL_KNEE_Z = 366    # feed flange front edge: everything behind it keeps its z


def shape(p):
    x, z, h = p
    if z < BARREL_KNEE_Z:
        z = BARREL_KNEE_Z - BARREL_STRETCH * (BARREL_KNEE_Z - z)
    return x * SECTION_SCALE, z, h * SECTION_SCALE


def render(angle):
    a, e = math.radians(angle), math.radians(12)
    ca, sa, ce, se = math.cos(a), math.sin(a), math.cos(e), math.sin(e)
    faces, bounds = [], []
    prefix = f'extruder-{angle}'

    def project(p):
        x, z, h = shape(p)
        return x * ca + z * sa, x * sa * se - z * ca * se - h * ce

    def face(points, fill, part, stroke='#454d50', width=.65):
        xy = [project(p) for p in points]
        # Depth is sorted on the reshaped geometry, like everything drawn.
        points = [shape(p) for p in points]
        bounds.extend(xy)
        depth = sum(x * sa * ce - z * ca * ce + h * se for x, z, h in points) / len(points)
        d = 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in xy) + ' Z'
        if fill.startswith('@'):
            fill = f'url(#{prefix}-{fill[1:]})'
        # Coplanar details must follow their supporting surfaces. Sorting only
        # by centroid would let a large panel cover half of its own grille.
        overlay = {'lower-fold':1, 'panel-seam':1, 'vent-inset':1,
                   'vent-slot':2, 'vent-lip':2, 'end-panel-bolt':2,
                   'machined-face':3,
                   'outlet-recess':4, 'outlet-bore':5, 'flange-bolt-hole':5}
        faces.append(((overlay.get(part,0),depth), f'<path data-part="{part}" d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{width}" stroke-linejoin="round"/>'))

    def box(x0, x1, z0, z1, h0, h1, colors, part):
        front, side, top = colors
        face([(x0,z0,h0),(x1,z0,h0),(x1,z0,h1),(x0,z0,h1)],front,part)
        if angle:
            face([(x1,z0,h0),(x1,z1,h0),(x1,z1,h1),(x1,z0,h1)],side,part)
        face([(x0,z0,h1),(x1,z0,h1),(x1,z1,h1),(x0,z1,h1)],top,part)

    def disc(x, z, h, r, fill, part, stroke='#454d50'):
        face([(x+r*math.cos(t*math.tau/64),z,h+r*math.sin(t*math.tau/64)) for t in range(64)], fill,part,stroke)

    def cylinder(x,z0,z1,h,r,part,metal=False):
        n=48
        for i in range(n):
            t0,t1=i*math.tau/n,(i+1)*math.tau/n
            mid=(t0+t1)/2
            if math.cos(mid)*sa*ce+math.sin(mid)*se < 0:
                continue
            light=max(0, .3*math.cos(mid)+.8*math.sin(mid))
            v=int((112 if metal else 41)+(95 if metal else 32)*light)
            col=f'#{v:02x}{min(v+4,255):02x}{min(v+5,255):02x}'
            face([(x+r*math.cos(t0),z0,h+r*math.sin(t0)),(x+r*math.cos(t0),z1,h+r*math.sin(t0)),(x+r*math.cos(t1),z1,h+r*math.sin(t1)),(x+r*math.cos(t1),z0,h+r*math.sin(t1))],col,part,col,.25)
        disc(x,z0-.05,h,r,'@metal' if metal else '@drive',part)

    dark=('#343b3e','#424a4e','#5b6468')
    # Low steel base, leveling feet, brackets and fasteners.
    for z in (95,515):
        for x in (-83,83):
            box(x-22,x+22,z-29,z+29,0,5,('#343a3d','#41494c','#626b6f'),'foot')
            box(x-7,x+7,z-9,z+9,5,27,('#7b8488','#899297','#bec6c8'),'leveling-bolt')
            box(x-12,x+12,z-15,z+15,22,53,dark,'support-bracket')
    box(-74,74,0,628,16,72,dark,'base')
    box(-68,68,4,621,72,83,('#171e22','#232b2f','#3a4246'),'housing-gasket')
    # Enclosed barrel, matching the photograph's broad unbranded side panel.
    box(-75,75,0,620,83,270,('@end','#e8ebea','@lid'),'housing')
    # A subtle lower folded edge and rear service-panel seam.
    face([(75.1,6,84),(75.1,618,84),(75.1,618,91),(75.1,6,91)],'#cbd1d1','lower-fold','#cbd1d1') if angle else None
    if angle:
        face([(75.2,477,98),(75.2,478.5,98),(75.2,478.5,257),(75.2,477,257)],'#c3caca','panel-seam','#c3caca',0)
    # Recessed ventilation grille on top, kept simple enough for small UI sizes.
    face([(-57,30,270.2),(57,30,270.2),(57,355,270.2),(-57,355,270.2)],'#c1c9ca','vent-inset','#a8b2b5',.8)
    for z in range(39,349,14):
        face([(-53,z,270.4),(53,z,270.4),(53,z+4,270.4),(-53,z+4,270.4)],'#727e82','vent-slot','#727e82',0)
        face([(-53,z+4,270.5),(53,z+4,270.5),(53,z+6,270.5),(-53,z+6,270.5)],'#e4e8e7','vent-lip','#e4e8e7',0)
    # Gearbox and longitudinal finned motor at the rear.
    box(-49,49,416,487,272,342,('#30383c','#3f474b','#61696b'),'gearbox')
    box(-55,55,424,606,271,279,dark,'motor-mount')
    cylinder(0,477,607,319,44,'motor')
    for i in range(15):
        t=math.pi * (-.46 + i/14*1.38)
        if math.cos(t)*sa*ce+math.sin(t)*se <= 0:
            continue
        dt=.017
        face([(46*math.cos(t-dt),490,319+46*math.sin(t-dt)),(46*math.cos(t-dt),600,319+46*math.sin(t-dt)),(46*math.cos(t+dt),600,319+46*math.sin(t+dt)),(46*math.cos(t+dt),490,319+46*math.sin(t+dt))],'#7b8385','motor-fin','#282f33',.45)
    cylinder(0,606,626,319,46,'fan-cover')
    box(-25,25,538,581,358,380,('#343b3e','#41494d','#697174'),'terminal-box')
    cylinder(0,408,416,311,22,'gearbox-cover')
    for x in (-33,33):
        for h in (287,329):
            disc(x,415.8,h,3,'#aeb7b9','gearbox-bolt')
    # Short feed throat: the mixer can connect directly above this surface.
    box(-28,28,372,411,270,299,('#879194','#a3adaf','#d8dedd'),'feed-neck')
    box(-35,35,366,417,299,306,('#929da0','#bbc3c4','#edf0ed'),'feed-flange')
    for x in (-27,27):
        box(x-3,x+3,371,378,306,310,('#6c797d','#8f9b9e','#d8dfdf'),'feed-bolt')
    # Die-facing outlet: a recessed boss, machined flange and eight bolt holes.
    cylinder(0,-10,-.1,172,51,'outlet-boss')
    cylinder(0,-24,-10.2,172,45,'outlet-flange',True)
    disc(0,-24.2,172,38,'@metal','machined-face','#d7dede')
    disc(0,-24.4,172,18,'#6a767b','outlet-recess','#a4afb3')
    disc(0,-24.6,172,12,'#11191d','outlet-bore','#303b40')
    for i in range(8):
        t=i*math.tau/8 + math.pi/8
        x,h=33*math.cos(t),172+33*math.sin(t)
        disc(x,-24.8,h,3.7,'#445157','flange-bolt-hole','#e7eceb')
    for x in (-62,62):
        for h in (99,254):
            disc(x,-.2,h,2.5,'#7c888c','end-panel-bolt','#232c31')

    minx, maxx = min(p[0] for p in bounds)-18, max(p[0] for p in bounds)+18
    # Shared vertical framing and unit scale across all angles, wide enough
    # for the reshaped machine (motor top near -548, base near +25).
    miny, height = -565, 610
    width=maxx-minx
    outlet=project((0,-24.6,172))
    defs=f'''<defs>
      <linearGradient id="{prefix}-lid" x2="0.2" y2="1"><stop stop-color="#fafbf8"/><stop offset="1" stop-color="#d5dcdb"/></linearGradient>
      <linearGradient id="{prefix}-end" x2="1" y2="0.5"><stop stop-color="#454d50"/><stop offset="1" stop-color="#30373b"/></linearGradient>
      <linearGradient id="{prefix}-metal" x1="0" y1="0" x2="0.8" y2="1"><stop stop-color="#f2f4f1"/><stop offset=".48" stop-color="#c3cccf"/><stop offset="1" stop-color="#89979e"/></linearGradient>
      <linearGradient id="{prefix}-drive" x2="1" y2="1"><stop stop-color="#5e676b"/><stop offset="1" stop-color="#252d31"/></linearGradient>
    </defs>'''
    body='\n'.join(s for _,s in sorted(faces,key=lambda f:f[0]))
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{minx:.2f} {miny} {width:.2f} {height}" width="{width:.2f}" height="{height}" role="img" aria-labelledby="{prefix}-title {prefix}-desc" data-yaw="{angle}" data-outlet-x="{outlet[0]:.2f}" data-outlet-y="{outlet[1]:.2f}">
    <title id="{prefix}-title">Extruder housing — {angle} degree view from the die</title>
    <desc id="{prefix}-desc">White enclosed screw barrel with a dark steel base, circular metal outlet flange, ventilated lid, feed connection and rear motor. Transparent background. Orthographic view at 12 degrees elevation.</desc>
    {defs}
    {body}
    </svg>'''
    return svg, width, height


views={}
for angle,name in ((0,'front'),(30,'intermediate'),(60,'angled')):
    svg,w,h=render(angle)
    ET.fromstring(svg)
    (OUT/f'extruder-{name}.svg').write_text(svg+'\n')
    views[name]=(svg,w,h)

# Self-contained contact sheet; all illustrations remain vector paths.
sheet=['<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="760" viewBox="0 0 1440 760">',
       '<rect width="1440" height="760" fill="#f3f5f4"/>',
       '<g font-family="Arial, sans-serif" fill="#253239"><text x="64" y="70" font-size="14" letter-spacing="3">EXTRUDER / SVG ASSET STUDY</text><text x="64" y="123" font-size="36">Three views. One machine.</text><text x="64" y="160" font-size="18" fill="#627176">Viewed from the die • 12° elevation • transparent individual assets</text></g>']
for i,(name,label,angle) in enumerate((('front','Front',0),('intermediate','Intermediate',30),('angled','Reference angle',60))):
    svg,w,h=views[name]
    x=48+i*456
    sheet.append(f'<rect x="{x}" y="204" width="432" height="508" rx="18" fill="#fff" stroke="#dce2df"/>')
    scale=min(392/w,385/h)
    # Nested SVG establishes each original viewBox without rasterization.
    nested=svg.replace(f'width="{w:.2f}" height="{h}"',f'x="{x+(432-w*scale)/2:.2f}" y="240" width="{w*scale:.2f}" height="{h*scale:.2f}"',1)
    sheet.append(nested)
    sheet.append(f'<g font-family="Arial, sans-serif"><text x="{x+28}" y="661" fill="#253239" font-size="21">{label}</text><text x="{x+28}" y="689" fill="#627176" font-size="14">{angle}° yaw</text></g>')
sheet.append('</svg>')
(OUT/'preview.svg').write_text('\n'.join(sheet)+'\n')
print('Generated three extruder SVGs and the contact sheet in',OUT)
