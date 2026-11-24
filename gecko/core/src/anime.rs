//! Anime hôm nay (from TyranWeb): one 2000–2010 anime a day from AniList, for the new tab page.
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex, time::Duration};

const QUERY: &str = "query ($page: Int, $genre: String) { Page(page: $page, perPage: 50) { media(type: ANIME, format_in: [TV, MOVIE, OVA, ONA], startDate_greater: 20000000, startDate_lesser: 20101231, sort: POPULARITY_DESC, isAdult: false, genre: $genre) { id siteUrl title { romaji english native } startDate { year } seasonYear episodes format coverImage { extraLarge color } bannerImage genres averageScore studios(isMain: true) { nodes { name } } description(asHtml: false) } } }";

fn today() -> String {
    // (the day as AniList's picks change: UTC, as TyranWeb did)
    let days = crate::store::now_ms() / 86_400_000;
    let (y, m, d) = civil(days as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

// days since 1970-01-01 -> (year, month, day)
fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn today_pick(genre: &str) -> Result<Value, String> {
    static CACHE: Mutex<Option<HashMap<String, Value>>> = Mutex::new(None);
    let day = today();
    let key = format!("{day}|{genre}");
    if let Some(v) = CACHE.lock().unwrap().as_ref().and_then(|c| c.get(&key)) {
        return Ok(v.clone());
    }
    let seed = day.chars().fold(7u32, |a, c| a.wrapping_mul(31).wrapping_add(c as u32));
    let page = 1 + (seed % 2);
    let vars = if genre == "all" || genre.is_empty() { json!({ "page": page }) } else { json!({ "page": page, "genre": genre }) };
    let body = json!({ "query": QUERY, "variables": vars });
    let res: Value = ureq::post("https://graphql.anilist.co")
        .timeout(Duration::from_secs(15))
        .set("Content-Type", "application/json")
        .set("Accept", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))?;
    let list = res["data"]["Page"]["media"].as_array().cloned().unwrap_or_default();
    if list.is_empty() {
        return Err("empty".into());
    }
    let m = &list[seed as usize % list.len()];
    let strip = |s: &str| {
        let mut out = String::new();
        let mut tag = false;
        for c in s.chars() {
            match c {
                '<' => tag = true,
                '>' => tag = false,
                _ if !tag => out.push(c),
                _ => {}
            }
        }
        out.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(320).collect::<String>()
    };
    let v = json!({
        "id": m["id"], "url": m["siteUrl"],
        "title": m["title"]["english"].as_str().or(m["title"]["romaji"].as_str()).unwrap_or(""),
        "romaji": m["title"]["romaji"], "native": m["title"]["native"],
        "year": if m["startDate"]["year"].is_null() { m["seasonYear"].clone() } else { m["startDate"]["year"].clone() },
        "episodes": m["episodes"], "format": m["format"],
        "cover": m["coverImage"]["extraLarge"], "color": m["coverImage"]["color"], "banner": m["bannerImage"],
        "genres": m["genres"].as_array().cloned().unwrap_or_default(), "score": m["averageScore"],
        "studio": m["studios"]["nodes"][0]["name"].as_str().unwrap_or(""),
        "description": strip(m["description"].as_str().unwrap_or("")),
    });
    CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(key, v.clone());
    Ok(v)
}
