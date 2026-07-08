import { getSystemSettings } from "@/lib/db/repositories";

export interface TmdbSeriesSummary {
  id: number;
  name: string;
  originalName: string;
  overview: string;
  posterPath: string | null;
  firstAirDate: string | null;
}

export async function getTmdbSeries(seriesId: number) {
  const settings = getSystemSettings();
  if (!settings.tmdbBearerToken) return null;

  const response = await fetch(
    `https://api.themoviedb.org/3/tv/${seriesId}?language=zh-CN`,
    {
      headers: {
        Authorization: `Bearer ${settings.tmdbBearerToken}`,
        Accept: "application/json"
      },
      next: { revalidate: 60 * 60 * 12 }
    }
  );

  if (!response.ok) return null;
  const data = (await response.json()) as Record<string, unknown>;
  return {
    id: Number(data.id),
    name: String(data.name ?? ""),
    originalName: String(data.original_name ?? ""),
    overview: String(data.overview ?? ""),
    posterPath: data.poster_path ? String(data.poster_path) : null,
    firstAirDate: data.first_air_date ? String(data.first_air_date) : null
  } satisfies TmdbSeriesSummary;
}

export function tmdbPosterUrl(path: string | null, size = "w342") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}
