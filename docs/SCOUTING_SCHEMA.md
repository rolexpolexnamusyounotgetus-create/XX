# Scouting files: data/scouting/<slug>.json

One file per big-name fighter, written by research agents and checked by a fact-checker. The engine
never takes a number from here unless it is sourced; the director uses the technique lists to pick
what each fighter throws in the 3D show; the rig uses the appearance block for the avatar; the page
shows the status and style notes.

```jsonc
{
  "slug": "alexander-volkanovski",            // must match data/derived/fighters.json
  "name": "Alexander Volkanovski",
  "as_of": "2026-11-06",
  "status": {
    "summary": "UFC featherweight champion after stopping Movsar Evloev at UFC 333 (Oct 24, 2026).",
    "title": "UFC featherweight champion",       // or null
    "ranking": "#1 pound-for-pound (UFC, Oct 2026)", // or null; say whose ranking and when
    "active": true,                              // false if retired or indefinitely out
    "next_fight": null,                          // booked bout or null
    "injuries": [ { "what": "...", "when": "2026-06", "source": "url" } ],
    "sources": ["url", "..."]
  },
  "style": {
    "archetype": "volume striker",               // one of ARCHETYPES below
    "stance": "orthodox",                        // orthodox | southpaw | switch
    "tags": ["volume", "feints", "switch-stance", "leg-kicks", "takedown-defense", "cardio"],  // only from TAGS below
    "signature": ["one-two", "overhand right", "inside low kick", "level-change feint"],       // free text, sourced
    "weaknesses": ["smaller frame at 155", "KO'd by Makhachev head kick and Topuria right hand"],
    "summary": "Two or three sentences in plain English.",
    "sources": ["url", "..."]
  },
  "moves": {                                     // director weights: what he actually throws (0..1, relative)
    "jab": 0.3, "cross": 0.27, "hook": 0.15, "overhand": 0.14, "upper": 0.1, "headkick": 0.04,
    "bodykick": 0.5, "bodyhook": 0.3, "bodystraight": 0.2,
    "calf": 0.55, "inside": 0.45, "spinning": 0.0, "knee": 0.0, "elbow": 0.0,
    "notes": "how these were judged, with sources"
  },
  "appearance": {                                // for the 3D avatar; describe, don't guess
    "build": "compact, thick through the chest and legs",
    "hair": "short dark brown",                  // e.g. bald, buzzed, short, long tied back; colour
    "facial_hair": "none",                       // e.g. full beard, stubble, none
    "skin": "light",                             // light | light-medium | medium | medium-dark | dark
    "tattoos": "none notable",                   // only if sourced
    "kit": "usually black or white shorts",      // only if sourced; corner colour wins in the sim
    "sources": ["url", "..."]
  },
  "engine_notes": [                              // optional, sourced judgments the knobs could use
    { "note": "Output rises in rounds 4-5 across his title fights.", "source": "url or dataset" }
  ],
  "confidence": "high"                           // overall: high | medium | low
}
```

**ARCHETYPES:** pressure striker, counter striker, volume striker, power puncher, kickboxer,
muay thai, karate/point fighter, boxer, wrestler, wrestle-boxer, chain wrestler (sambo/dagestani),
grappler/BJJ, all-rounder.

**TAGS:** pressure, counter, volume, power, jab, leg-kicks, calf-kicks, body-work, head-kicks,
spinning, flying-knee, clinch, dirty-boxing, elbows, knees, chain-wrestling, single-leg, double-leg,
trips, cage-wrestling, top-control, ground-and-pound, submissions, back-takes, guillotine, leg-locks,
scrambles, takedown-defense, get-ups, switch-stance, southpaw, feints, head-movement, footwork,
range-control, rangy, short-range, cardio, durable, chin-concern, fast-starter, slow-starter,
late-surge, fades-late, wild-exchanges.
