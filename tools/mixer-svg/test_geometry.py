"""Regression checks for the chamber/frame and drain-valve alignment defects."""
import math
import sys
import unittest
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
from generate import render


class MixerGeometryTests(unittest.TestCase):
    def scene(self, angle):
        faces = []
        svg, _, _ = render(angle, 'ui', geometry=faces)
        return faces, ET.fromstring(svg)

    def test_chamber_and_complete_door_fit_inside_frame_at_every_angle(self):
        parts = {'mixing-chamber', 'inspection-rim', 'inspection-cover',
                 'inspection-window', 'agitator-glimpse', 'cover-knob',
                 'knob-center', 'cover-hinge', 'cover-latch', 'door-hinge'}
        for angle in (0, 15, 30, 45, 60):
            faces, _ = self.scene(angle)
            for face in faces:
                if face['part'] not in parts:
                    continue
                for x, z, h in face['points']:
                    with self.subTest(angle=angle, part=face['part']):
                        # Inner edges of the actual front and rear posts,
                        # rather than the wider external frame silhouette.
                        self.assertGreaterEqual(x, -90)
                        self.assertLessEqual(x, 90)
                        self.assertGreaterEqual(z, -40)
                        self.assertLessEqual(z, 62)
                        self.assertGreater(h, 40)
                        self.assertLess(h, 391)

    def test_valves_mount_on_beam_and_mouths_stay_between_corners(self):
        for angle in (0, 15, 30, 45, 60):
            faces, _ = self.scene(angle)
            mouths = [face['points'] for face in faces if face['part'] == 'inlet-rim']
            self.assertEqual(len(mouths), 3)
            centers = [tuple(sum(p[i] for p in pts)/len(pts) for i in range(3)) for pts in mouths]
            self.assertAlmostEqual(centers[1][0]-centers[0][0], centers[2][0]-centers[1][0])
            self.assertAlmostEqual(centers[1][0], 0)
            for center in centers:
                self.assertAlmostEqual(center[1], centers[0][1])
                self.assertAlmostEqual(center[2], centers[0][2])
            # Each opening lies in a plane parallel to the front beam; the
            # old tilted cut made it nearly disappear at the outer angle.
            for pts in mouths:
                self.assertLess(max(p[1] for p in pts)-min(p[1] for p in pts), 1e-9)
            ca, sa = math.cos(math.radians(angle)), math.sin(math.radians(angle))
            left, right = -108*ca-62*sa, 108*ca-62*sa
            for pts in mouths:
                for x, z, _ in pts:
                    self.assertGreater(x*ca+z*sa, left)
                    self.assertLess(x*ca+z*sa, right)
            # Rear rings seat on the top crossmember rather than drifting
            # over a side rail as the camera turns.
            bodies = [p for f in faces if f['part'] == 'inlet-chute' for p in f['points']]
            rear_z = max(p[1] for p in bodies)
            mounts = [p for p in bodies if abs(p[1]-rear_z) < 1e-8]
            self.assertGreater(rear_z, -63)
            self.assertLess(rear_z, -40)
            self.assertTrue(all(-90 < p[0] < 90 for p in mounts))
            # Only camera-facing side bands are emitted. Recover the hidden
            # lower mounting edge from the equal-diameter outlet ring.
            diameter = max(p[2] for p in mouths[0])-min(p[2] for p in mouths[0])
            self.assertLess(max(p[2] for p in mounts)-diameter, 418)
            self.assertGreater(max(p[2] for p in mounts), 418)

    def test_export_projects_corrected_geometry_and_paints_posts_over_door(self):
        for angle in (0, 30, 60):
            faces, root = self.scene(angle)
            paths = list(root.iter('{http://www.w3.org/2000/svg}path'))
            self.assertEqual(len(paths), len(faces))
            a, e = math.radians(angle), math.radians(12)
            for face, path in zip(faces, paths):
                self.assertEqual(face['part'], path.attrib['data-part'])
                points = [tuple(map(float, pair.split(','))) for pair in path.attrib['d'][1:-2].split(' L')]
                for (x, z, h), (u, v) in zip(face['points'], points):
                    self.assertAlmostEqual(u, x*math.cos(a)+z*math.sin(a), delta=.006)
                    self.assertAlmostEqual(v, x*math.sin(a)*math.sin(e)-z*math.cos(a)*math.sin(e)-h*math.cos(e), delta=.006)
            order = [p.attrib['data-part'] for p in paths]
            self.assertGreater(order.index('front-upright'), max(i for i, part in enumerate(order) if part == 'inspection-window'))
            self.assertEqual(root.attrib['data-outlet-x'], '0')
            self.assertEqual(root.attrib['data-outlet-y'], '0')


if __name__ == '__main__':
    unittest.main()
