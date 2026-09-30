import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface CityRow extends Array<unknown> {
  0: string
  1: number
  2: number
  3: string
  4: string
  5: number
}

export interface Place {
  city: string
  admin: string
  country: string
  cc: string
  /** km from the photo to the city center */
  distance: number
}

const DEG = Math.PI / 180

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG
  const dLon = (lon2 - lon1) * DEG
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

/**
 * Offline reverse geocoding on GeoNames cities (population ≥ 15 000), bucketed by degree cell.
 * Prefers a nearby city; a big city wins over a small suburb at similar distance.
 */
export class Geocoder {
  private cells = new Map<string, CityRow[]>()
  private countries: Record<string, string>

  constructor(file: string) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { countries: Record<string, string>; cities: CityRow[] }
    this.countries = raw.countries
    for (const c of raw.cities) {
      const key = `${Math.floor(c[1])}:${Math.floor(c[2])}`
      const list = this.cells.get(key)
      if (list) list.push(c)
      else this.cells.set(key, [c])
    }
  }

  static load(resourcesDir: string): Geocoder {
    return new Geocoder(join(resourcesDir, 'geo', 'cities.json'))
  }

  lookup(lat: number, lon: number, maxKm = 60): Place | null {
    let best: { c: CityRow; d: number; score: number } | null = null
    const la = Math.floor(lat)
    const lo = Math.floor(lon)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.cells.get(`${la + dy}:${(((lo + dx + 180) % 360) + 360) % 360 - 180}`)
        if (!list) continue
        for (const c of list) {
          const d = haversine(lat, lon, c[1], c[2])
          if (d > maxKm) continue
          // effective distance: big cities "reach" further than small towns
          const reach = 3 + Math.log10(Math.max(1000, c[5])) * 2.2
          const score = d / reach
          if (!best || score < best.score) best = { c, d, score }
        }
      }
    }
    if (!best) return null
    return { city: best.c[0], admin: best.c[4], country: this.countries[best.c[3]] ?? best.c[3], cc: best.c[3], distance: best.d }
  }
}
