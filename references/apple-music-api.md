# Apple iTunes API Reference

## Search Endpoint

```
GET https://itunes.apple.com/search
```

### Parameters

| Parameter | Required | Values | Description |
|---|---|---|---|
| `term` | Yes | String | Search query text. Spaces encoded as `+` or `%20`. |
| `limit` | No | 1–200 (default: 50) | Maximum number of results to return. |
| `entity` | No | musicTrack, musicArtist, album, musicVideo, podcast, audiobook, shortFilm, tvShow, software, ebook, all | Filters results to the specified media type. Default: `all`. |
| `country` | No | ISO 3166-1 alpha-2 (default: US) | iTunes Store territory. Affects available content and pricing. |

### Entity type map

| Media Type | Available Entities |
|---|---|
| music | musicArtist, musicTrack, album, musicVideo, mix, song |
| musicTrack | Returns individual song tracks (includes both songs and music videos) |
| musicArtist | Returns artist information |
| album | Returns album information |
| musicVideo | Returns music video results |
| podcast | Returns podcast results |
| all | Returns across all media types (default when entity not specified) |

### Response fields (track entity)

- `trackName`: String — The song name
- `artistName`: String — The performing artist
- `collectionName`: String — The album/collection name
- `trackTimeMillis`: Integer — Duration in milliseconds
- `previewUrl`: String — Direct audio preview URL (M4A/AAC format, ~90s)
- `artworkUrl30`, `artworkUrl60`, `artworkUrl100`: String — Image URLs at three resolutions
- `collectionPrice`: Float — Album price in store currency
- `trackPrice`: Float — Individual track price
- `primaryGenreName`: String — Music genre classification
- `currency`: String — ISO currency code (USD, EUR, etc.)
- `trackExplicitness`: String — "clean" or "explicit"
- `isStreamable`: Boolean — Whether the track can be streamed/purchased

## Lookup Endpoint

```
GET https://itunes.apple.com/lookup
```

### Parameters

- `id`: Required — iTunes Store item ID
- `entity`: Optional — Limits result type (musicTrack, musicArtist, album, etc.)

### Returns

A single result dictionary with the same fields as the search endpoint, plus:
- `artistViewUrl`: URL to the artist page
- `collectionViewUrl`: URL to the album/page
- `trackViewUrl`: URL to the track page

## Rate limits

- Approximately 20 requests per minute per IP address
- Exceeding returns HTTP 429 (Too Many Requests)
- For heavier usage, consider Apple's Enterprise Partner Feed (EPF)

## Legal

- Previews are provided at Apple's discretion for evaluation purposes
- Do not redistribute downloaded preview files beyond fair use
- Purchase through iTunes Store or Apple Music for full access