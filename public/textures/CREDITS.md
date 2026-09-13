# Mars

`mars-8k.jpg`: Solar System Scope / INOVE, https://www.solarsystemscope.com/textures/ — CC BY 4.0, https://creativecommons.org/licenses/by/4.0/. Downloaded unchanged from https://www.solarsystemscope.com/textures/download/8k_mars.jpg. Based on NASA imagery; colours are enhanced and gaps may be filled artistically as described by its author.

`mars-radius.img`: NASA MGS MOLA MEGDR planetary radius map, David E. Smith / GSFC MOLA Team; archive maintained by Washington University PDS Geosciences Node. https://pds-geosciences.wustl.edu/missions/mgs/megdr.html — product megr90n000cb, 1440×720, 4 pixels/degree, signed big-endian metres with 3396000 m offset. Downloaded unchanged from the PDS4 bundle. Rendering uses bilinear sampling and no vertical exaggeration. This is roughly 15 km spacing at the equator, not landing-scale surveyed detail.

`mars-nasa.jpg`: NASA / Jet Propulsion Laboratory & Caltech. Viking images processed at USGS; JPL/Caltech planetary map database. Downloaded unmodified from https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/image/mars/Mars.jpg on 2026-09-12. Source: https://science.nasa.gov/3d-resources/mars/

Used as a globe colour map, not an elevation dataset. No claim of terrain geometry or current surface/weather observations.

Close-range surface: MOLA radii above, sampled bicubically, plus procedural craters, ridges, roughness and rocks generated in `src/mars-geo.ts` and `src/mars-surface.ts`. These are plausible detail, not observations.

`mars-canyon-radius.img`: NASA MGS MOLA MEGDR 128 pixels/degree planetary radius, product megr00n270hb (David E. Smith / GSFC MOLA Team; PDS Geosciences Node, https://pds-geosciences.wustl.edu/missions/mgs/megdr.html). Unresampled crop covering 0° to 16°S and 280° to 300°E; `tests/fetch-mola-region.py` reproduces it.
