# Station avatar assets

Developer notes. Not part of the app, not loaded by it.

The two files in `station/assets/` that `station/station-avatar.js` shows
are crops of one source photograph of Station (waving, on the floor in
front of the line). They were made once, by hand, with ImageMagick; the
source photograph is not in the repository.

Source: 857 x 1835 px. Coordinates below are in the source's pixels.

```
# The face, for the header: a 300px square around the head, at 96px for a
# 32px slot on a dense display.
magick source.png -crop 300x300+265+405 +repage -resize 96x96 -strip -quality 88 \
  station/assets/station-avatar.jpg

# The larger picture the header's face opens: the face, the wave and the
# line behind, at twice the panel's 320 x 380 box.
magick source.png -crop 640x760+110+340 +repage -strip -quality 84 \
  station/assets/station-portrait.jpg
```

If the source changes, re-cut both from it rather than editing the outputs:
`station-avatar.test.js` pins the panel's declared box (320 x 380) to the
portrait's aspect, and the header's face is expected to be square.
