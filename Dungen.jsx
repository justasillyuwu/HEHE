/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  INFINITE PIXEL DUNGEON CRAWLER                                  ║
 * ║  Pokémon Red battle · Infinite floors · Scaling difficulty       ║
 * ║  Framer-ready · SVG-only · Touch + Keyboard · Game Boy / DOS     ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  ARCHITECTURE                                                    ║
 * ║  ─────────────────────────────────────────────────────────────  ║
 * ║  /core          Game loop, state machine, syncUI bridge          ║
 * ║  /map           Dungeon generator — BSP rooms + corridors        ║
 * ║                 Only ONE floor in memory at a time               ║
 * ║  /progression   dungeonProgression — floor transition logic      ║
 * ║  /scaling       difficultyScaling  — all enemy stat formulas     ║
 * ║  /entities      Player, Enemy templates, item/spell defs         ║
 * ║  /systems       Movement, combat, collision, status effects      ║
 * ║  /input         Keyboard (with key-repeat) + touch D-pad bridge  ║
 * ║  /svg           Pure string renderers — tile, player, enemy      ║
 * ║  /ui            React-only overlay — HUD, battle, panels         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { useEffect, useRef, useCallback, useState } from "react"

// ═══════════════════════════════════════════════════════
//  PALETTE  — strict retro palette, no gradients
// ═══════════════════════════════════════════════════════
const C = {
  black:       "#0a0a12",
  darkBlue:    "#12121f",
  midBlue:     "#161628",
  wallEdge:    "#252545",
  floor:       "#1a1a28",
  floorAlt:    "#1e1e30",
  stairs:      "#1a3a1a",
  stairsHi:    "#2d5c2d",
  player:      "#00e87a",
  playerDk:    "#00b85e",
  gold:        "#ffd700",
  silver:      "#aabbcc",
  uiBg:        "#080812",
  uiBorder:    "#223355",
  uiBox:       "#0e0e1e",
  uiBoxHover:  "#1a1a30",
  textBright:  "#ddeeff",
  textDim:     "#557799",
  textGold:    "#ffd700",
  textGreen:   "#44ffaa",
  textRed:     "#ff4455",
  hpGreen:     "#33ee77",
  hpYellow:    "#eeee33",
  hpRed:       "#ff3344",
  mpBlue:      "#3399ff",
  xpPurple:    "#9955ff",
  fire:        "#ff6622",
  ice:         "#66ccff",
  thunder:     "#ffdd00",
  dark:        "#8822bb",
  heal:        "#44ffaa",
  // Enemy tiers
  eNormal:     "#dd3344",
  eNormalDk:   "#991122",
  eElite:      "#ff8800",
  eEliteDk:    "#bb5500",
  eRare:       "#aa44ff",
  eRareDk:     "#771acc",
  eBoss:       "#ff44cc",
  eBossDk:     "#bb1188",
  slimeGreen:  "#33cc66",
  slimeDk:     "#226644",
  skelWhite:   "#ccddee",
  skelDk:      "#889aaa",
  trollGreen:  "#557733",
  trollDk:     "#334422",
}

// ═══════════════════════════════════════════════════════
//  MAP CONSTANTS
// ═══════════════════════════════════════════════════════
const TILE   = 16
const MAP_W  = 42
const MAP_H  = 42
const VIEW_W = 19
const VIEW_H = 13
const CW = VIEW_W * TILE
const CH = VIEW_H * TILE

const T_WALL=0, T_FLOOR=1, T_STAIRS=2, T_ITEM=3

// ═══════════════════════════════════════════════════════
//  /scaling — difficultyScaling
//  All difficulty math lives here, isolated from rendering
// ═══════════════════════════════════════════════════════
const DifficultyScaling = {
  /**
   * Core formula: smooth exponential growth
   *   scaleFactor = 1 + floor * 0.18 + floor² * 0.004
   * This gives:
   *   Floor 1:  ×1.18   Floor 5:  ×1.99
   *   Floor 10: ×3.2    Floor 20: ×7.4   Floor 50: ×31
   * Gradual early, punishing deep
   */
  scaleFactor(floor) {
    return 1 + floor * 0.18 + floor * floor * 0.004
  },

  /** Enemy level derived from floor */
  enemyLevel(baseLevel, floor) {
    return baseLevel + Math.floor(floor * 0.8)
  },

  /** HP scales faster than ATK for meaningful fights */
  enemyHp(baseHp, floor) {
    const s = this.scaleFactor(floor)
    return Math.ceil(baseHp * s)
  },

  enemyAtk(baseAtk, floor) {
    const s = 1 + floor * 0.14 + floor * floor * 0.002
    return Math.ceil(baseAtk * s)
  },

  enemyDef(baseDef, floor) {
    return baseDef + Math.floor(floor / 4)
  },

  enemyXp(baseXp, floor) {
    return Math.ceil(baseXp * (1 + floor * 0.2))
  },

  enemyGold(baseGold, floor) {
    return Math.ceil(baseGold * (1 + floor * 0.25))
  },

  /** How many enemies per room (capped at 4) */
  enemyCountPerRoom(floor) {
    return Math.min(4, 1 + Math.floor(floor / 3))
  },

  /** Chance of elite spawn (0→0.05, 10→0.3, 30→0.6, cap 0.7) */
  eliteChance(floor) {
    return Math.min(0.70, 0.05 + floor * 0.025)
  },

  /** Chance of rare/magic spawn */
  rareChance(floor) {
    return Math.min(0.40, 0.02 + floor * 0.012)
  },

  /** Is this a boss floor? Every 5 floors */
  isBossFloor(floor) {
    return floor > 0 && floor % 5 === 0
  },

  /** Floor tint color — shifts as dungeon deepens */
  floorTint(floor) {
    if (floor <= 5)  return "#1a1a28"   // dark blue — surface
    if (floor <= 10) return "#1a1a1a"   // grey — mid depths
    if (floor <= 20) return "#1a0e0e"   // red tint — deep
    if (floor <= 35) return "#0e0e1a"   // purple — abyss
    return "#0a0a0a"                     // near black — void
  },

  wallTint(floor) {
    if (floor <= 5)  return "#12121f"
    if (floor <= 10) return "#121212"
    if (floor <= 20) return "#140a0a"
    if (floor <= 35) return "#0e0814"
    return "#080808"
  },

  /** Post-floor stat bonus for player (keeping up with enemies) */
  floorClearBonus(floor) {
    const every = 3
    if (floor % every !== 0) return null
    return {
      hp:    4 + Math.floor(floor / 5),
      mp:    2 + Math.floor(floor / 8),
      atk:   1 + Math.floor(floor / 10),
      def:   Math.floor(floor / 12),
      magAtk:1 + Math.floor(floor / 10),
    }
  },
}

// ═══════════════════════════════════════════════════════
//  SPELLS
// ═══════════════════════════════════════════════════════
const SPELLS = {
  fireball:  { name:"FIREBALL",  mp:8,  baseDmg:20, type:"fire",    desc:"Burns enemy (DoT)",       color:C.fire    },
  icebolt:   { name:"ICE BOLT",  mp:6,  baseDmg:15, type:"ice",     desc:"Freeze chance (1 turn)",   color:C.ice     },
  thunder:   { name:"THUNDER",   mp:12, baseDmg:28, type:"thunder", desc:"Ignore 50% DEF",           color:C.thunder },
  shadowstep:{ name:"SHADOW",    mp:5,  baseDmg:12, type:"dark",    desc:"Drain 30% dmg as HP",      color:C.dark    },
  cure:      { name:"CURE",      mp:10, baseDmg:0,  type:"heal",    desc:"Heal 35% max HP",          color:C.heal    },
  inferno:   { name:"INFERNO",   mp:18, baseDmg:45, type:"fire",    desc:"Massive fire damage",      color:C.fire    },
  blizzard:  { name:"BLIZZARD",  mp:16, baseDmg:38, type:"ice",     desc:"Freeze + damage",          color:C.ice     },
  void:      { name:"VOID",      mp:20, baseDmg:55, type:"dark",    desc:"Pure dark devastation",    color:C.dark    },
}

// ═══════════════════════════════════════════════════════
//  ITEMS
// ═══════════════════════════════════════════════════════
const ITEMS = {
  healthPotion: { name:"HP POTION",   color:C.hpGreen,  desc:"+30 HP",          rarity:"common",
    use: p => { p.hp = Math.min(p.maxHp, p.hp + 30) } },
  mpPotion:     { name:"MP POTION",   color:C.mpBlue,   desc:"+25 MP",          rarity:"common",
    use: p => { p.mp = Math.min(p.maxMp, p.mp + 25) } },
  elixir:       { name:"ELIXIR",      color:C.gold,     desc:"Full HP+MP",      rarity:"rare",
    use: p => { p.hp = p.maxHp; p.mp = p.maxMp } },
  sword:        { name:"IRON SWORD",  color:C.silver,   desc:"+6 ATK",          rarity:"common",
    use: p => { p.atk += 6 } },
  shield:       { name:"IRON SHIELD", color:C.silver,   desc:"+4 DEF",          rarity:"common",
    use: p => { p.def += 4 } },
  steelSword:   { name:"STEEL SWORD", color:"#88aaff",  desc:"+12 ATK",         rarity:"uncommon",
    use: p => { p.atk += 12 } },
  steelShield:  { name:"STEEL SHIELD",color:"#88aaff",  desc:"+8 DEF",          rarity:"uncommon",
    use: p => { p.def += 8 } },
  runeSword:    { name:"RUNE BLADE",  color:C.xpPurple, desc:"+20 ATK +10 MATK",rarity:"rare",
    use: p => { p.atk += 20; p.magAtk += 10 } },
  spellbook:    { name:"SPELLBOOK",   color:C.xpPurple, desc:"Learn a spell",   rarity:"uncommon",
    use: (p,_,gs) => learnRandomSpell(p, gs) },
  tome:         { name:"ARCANE TOME", color:"#cc88ff",  desc:"Learn 2 spells",  rarity:"rare",
    use: (p,_,gs) => { learnRandomSpell(p,gs); learnRandomSpell(p,gs) } },
  xpOrb:        { name:"XP ORB",      color:C.xpPurple, desc:"+50 XP",          rarity:"common",
    use: (p,_,gs) => { p.xp += 50; checkLevelUp(p, gs) } },
  maxUp:        { name:"POWER SEED",  color:C.gold,     desc:"+10 MAX HP +5 MP",rarity:"uncommon",
    use: p => { p.maxHp += 10; p.maxMp += 5; p.hp = Math.min(p.hp+10, p.maxHp) } },
}

const RARITY_COLOR = { common:"#889aaa", uncommon:"#44aaff", rare:C.xpPurple, legendary:C.gold }

function learnRandomSpell(player, gs) {
  const known   = player.spells
  const unknown = Object.keys(SPELLS).filter(s => !known.includes(s))
  if (unknown.length > 0) {
    const pick = unknown[Math.floor(Math.random() * unknown.length)]
    player.spells.push(pick)
    if (gs) gs.message = `Learned ${SPELLS[pick].name}!`
  } else {
    player.mp = Math.min(player.maxMp, player.mp + 20)
    if (gs) gs.message = "All spells known! +20 MP instead"
  }
}

// ═══════════════════════════════════════════════════════
//  ENEMY TEMPLATES  (base stats before scaling)
// ═══════════════════════════════════════════════════════
const ENEMY_TEMPLATES = {
  slime:    { name:"SLIME",      baseLevel:1,  hp:10, atk:3,  def:0, mp:0,  xp:6,  gold:1,  color:C.slimeGreen, colorDk:C.slimeDk,
              spells:[], rarity:"normal", moveInterval:70 },
  goblin:   { name:"GOBLIN",     baseLevel:2,  hp:16, atk:6,  def:1, mp:0,  xp:12, gold:3,  color:C.eNormal,    colorDk:C.eNormalDk,
              spells:[], rarity:"normal", moveInterval:60 },
  skeleton: { name:"SKELETON",   baseLevel:3,  hp:20, atk:8,  def:3, mp:0,  xp:16, gold:4,  color:C.skelWhite,  colorDk:C.skelDk,
              spells:[], rarity:"normal", moveInterval:65 },
  wizard:   { name:"DARK MAGE",  baseLevel:4,  hp:14, atk:3,  def:1, mp:30, xp:22, gold:7,  color:C.dark,       colorDk:"#551188",
              spells:["fireball","icebolt"], rarity:"normal", moveInterval:75 },
  troll:    { name:"TROLL",      baseLevel:5,  hp:32, atk:12, def:4, mp:0,  xp:28, gold:9,  color:C.trollGreen, colorDk:C.trollDk,
              spells:[], rarity:"normal", moveInterval:80 },
  wraith:   { name:"WRAITH",     baseLevel:7,  hp:22, atk:10, def:2, mp:20, xp:35, gold:12, color:C.eRare,      colorDk:C.eRareDk,
              spells:["shadowstep"], rarity:"rare", moveInterval:55 },
  lich:     { name:"LICH",       baseLevel:10, hp:28, atk:8,  def:4, mp:50, xp:50, gold:18, color:"#aaccff",    colorDk:"#5566aa",
              spells:["thunder","icebolt","fireball"], rarity:"rare", moveInterval:70 },
  // Elite variants (prefix-based)
  ogre:     { name:"OGRE",       baseLevel:6,  hp:45, atk:15, def:6, mp:0,  xp:40, gold:14, color:C.eElite,     colorDk:C.eEliteDk,
              spells:[], rarity:"elite", moveInterval:85 },
  demon:    { name:"DEMON",      baseLevel:12, hp:55, atk:20, def:7, mp:30, xp:70, gold:25, color:C.eElite,     colorDk:C.eEliteDk,
              spells:["fireball","shadowstep"], rarity:"elite", moveInterval:60 },
  // Boss (spawns only on boss floors, 1 per floor)
  floorBoss:{ name:"FLOOR BOSS", baseLevel:8,  hp:80, atk:18, def:8, mp:40, xp:120,gold:50, color:C.eBoss,      colorDk:C.eBossDk,
              spells:["thunder","fireball"], rarity:"boss", moveInterval:70 },
  voidLord: { name:"VOID LORD",  baseLevel:15, hp:140,atk:28, def:12,mp:80, xp:250,gold:100,color:C.eBoss,      colorDk:C.eBossDk,
              spells:["void","thunder","blizzard"], rarity:"boss", moveInterval:60 },
}

// ═══════════════════════════════════════════════════════
//  /scaling — createEnemy applies DifficultyScaling
// ═══════════════════════════════════════════════════════
function createEnemy(type, floor) {
  const t = ENEMY_TEMPLATES[type] || ENEMY_TEMPLATES.goblin
  const isBoss = t.rarity === "boss"
  const level  = DifficultyScaling.enemyLevel(t.baseLevel, floor)

  return {
    ...t,
    type,
    level,
    hp:     isBoss ? DifficultyScaling.enemyHp(t.hp, Math.floor(floor * 0.5)) : DifficultyScaling.enemyHp(t.hp, floor),
    maxHp:  isBoss ? DifficultyScaling.enemyHp(t.hp, Math.floor(floor * 0.5)) : DifficultyScaling.enemyHp(t.hp, floor),
    atk:    DifficultyScaling.enemyAtk(t.atk, floor),
    def:    DifficultyScaling.enemyDef(t.def, floor),
    mp:     t.mp,
    maxMp:  t.mp,
    xp:     DifficultyScaling.enemyXp(t.xp, floor),
    gold:   DifficultyScaling.enemyGold(t.gold, floor),
    spells: [...t.spells],
    id: Math.random(),
    x:0, y:0,
    face:-1, animFrame:0, animTimer:0,
    statusEffect:null, statusTimer:0,
  }
}

// ═══════════════════════════════════════════════════════
//  /progression — spawnEnemies
//  Uses DifficultyScaling to pick types + counts
// ═══════════════════════════════════════════════════════
function spawnEnemies(rooms, floor) {
  const enemies = []
  const isBossFloor = DifficultyScaling.isBossFloor(floor)

  // Pick available enemy pool based on floor depth
  const pool =
    floor >= 30 ? ["skeleton","wizard","wraith","lich","demon","ogre"] :
    floor >= 20 ? ["skeleton","wizard","troll","wraith","ogre"] :
    floor >= 12 ? ["goblin","skeleton","wizard","troll","ogre"] :
    floor >= 7  ? ["goblin","skeleton","wizard","troll"] :
    floor >= 4  ? ["goblin","skeleton","wizard"] :
                  ["slime","goblin"]

  const rarePool =
    floor >= 20 ? ["wraith","lich","demon"] :
    floor >= 10 ? ["wraith","lich"] :
    floor >= 6  ? ["wraith"] : []

  const elitePool =
    floor >= 15 ? ["ogre","demon"] :
    floor >= 8  ? ["ogre"] : []

  rooms.slice(1).forEach((room, roomIdx) => {
    const isLastRoom = roomIdx === rooms.length - 2

    // ── BOSS ROOM (last room on boss floors) ──
    if (isLastRoom && isBossFloor) {
      const bossType = floor >= 25 ? "voidLord" : "floorBoss"
      const boss = createEnemy(bossType, floor)
      boss.name = `${boss.name} (F${floor})`
      boss.x = room.cx; boss.y = room.cy
      enemies.push(boss)
      return
    }

    const count = DifficultyScaling.enemyCountPerRoom(floor)
    for (let n = 0; n < count; n++) {
      // Roll for rarity tier
      let type
      const r = Math.random()
      if (r < DifficultyScaling.rareChance(floor) && rarePool.length > 0) {
        type = rarePool[Math.floor(Math.random() * rarePool.length)]
      } else if (r < DifficultyScaling.eliteChance(floor) && elitePool.length > 0) {
        type = elitePool[Math.floor(Math.random() * elitePool.length)]
      } else {
        type = pool[Math.floor(Math.random() * pool.length)]
      }

      const e = createEnemy(type, floor)
      // Scatter inside room (avoid walls)
      e.x = room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2))
      e.y = room.y + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2))
      enemies.push(e)
    }
  })

  return enemies
}

// ═══════════════════════════════════════════════════════
//  /map — generateDungeon
//  Floor-aware: deeper floors get more rooms + tighter corridors
// ═══════════════════════════════════════════════════════
function generateDungeon(floor) {
  const tiles = Array.from({length:MAP_H}, () => new Uint8Array(MAP_W))
  const rooms = []

  // More rooms on deeper floors (up to cap)
  const attempts = Math.min(100, 60 + floor * 2)

  for (let i = 0; i < attempts; i++) {
    const w = 4 + Math.floor(Math.random() * 7)
    const h = 4 + Math.floor(Math.random() * 5)
    const x = 1 + Math.floor(Math.random() * (MAP_W - w - 2))
    const y = 1 + Math.floor(Math.random() * (MAP_H - h - 2))
    const room = { x, y, w, h, cx:x+Math.floor(w/2), cy:y+Math.floor(h/2) }
    const overlap = rooms.some(r =>
      room.x < r.x+r.w+1 && room.x+room.w+1 > r.x &&
      room.y < r.y+r.h+1 && room.y+room.h+1 > r.y
    )
    if (!overlap) rooms.push(room)
  }

  // Guarantee minimum rooms
  if (rooms.length < 4) rooms.push(
    {x:2,y:2,w:5,h:5,cx:4,cy:4},
    {x:20,y:15,w:6,h:5,cx:23,cy:17},
    {x:10,y:25,w:5,h:6,cx:12,cy:28},
    {x:30,y:5,w:5,h:4,cx:32,cy:7},
  )

  rooms.forEach(r => {
    for (let ty=r.y; ty<r.y+r.h; ty++)
      for (let tx=r.x; tx<r.x+r.w; tx++)
        tiles[ty][tx] = T_FLOOR
  })

  // Connect with L-corridors
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i-1], b = rooms[i]
    let cx = a.cx, cy = a.cy
    while (cx !== b.cx) { tiles[cy][cx] = T_FLOOR; cx += cx < b.cx ? 1 : -1 }
    while (cy !== b.cy) { tiles[cy][cx] = T_FLOOR; cy += cy < b.cy ? 1 : -1 }
  }

  // Stairs in last room center
  const lastRoom = rooms[rooms.length-1]
  tiles[lastRoom.cy][lastRoom.cx] = T_STAIRS

  // Scatter items — more loot on deeper floors
  const items = []
  const lootChance = Math.min(0.9, 0.45 + floor * 0.02)

  // Build weighted item pool (rare items appear more on deep floors)
  const itemPool = Object.entries(ITEMS)
    .filter(([_, it]) => {
      if (it.rarity === "legendary") return floor >= 20
      if (it.rarity === "rare")      return floor >= 8
      if (it.rarity === "uncommon")  return floor >= 3
      return true
    })
    .map(([key]) => key)

  rooms.slice(1, -1).forEach(r => {
    if (Math.random() < lootChance) {
      const ix = r.x + 1 + Math.floor(Math.random() * Math.max(1, r.w-2))
      const iy = r.y + 1 + Math.floor(Math.random() * Math.max(1, r.h-2))
      const type = itemPool[Math.floor(Math.random() * itemPool.length)]
      items.push({ x:ix, y:iy, type, id:Math.random() })
      tiles[iy][ix] = T_ITEM
    }
  })

  return { tiles, rooms, items }
}

// ═══════════════════════════════════════════════════════
//  PLAYER  (persistent across floors)
// ═══════════════════════════════════════════════════════
function createPlayer(x, y) {
  return {
    x, y,
    hp:40, maxHp:40,
    mp:20, maxMp:20,
    atk:8, def:2, spd:5, magAtk:8,
    xp:0, xpNext:30, level:1,
    gold:0, totalGold:0,
    spells:["fireball"],
    inventory:[],
    face:1, animFrame:0, animTimer:0,
    statusEffect:null, statusTimer:0,
    enemiesDefeated:0,
    floorsCleared:0,
    highestFloor:1,
  }
}

// ═══════════════════════════════════════════════════════
//  LEVELING
// ═══════════════════════════════════════════════════════
function checkLevelUp(player, gs) {
  while (player.xp >= player.xpNext) {
    player.xp    -= player.xpNext
    player.level ++
    player.xpNext = Math.ceil(player.xpNext * 1.55)
    player.maxHp += 10
    player.hp     = player.maxHp
    player.maxMp += 6
    player.mp     = player.maxMp
    player.atk   += 3
    player.def   += 1
    player.magAtk+= 3
    if (gs) {
      gs.pendingLevelUp  = true
      gs.levelUpMessage  = `Lv ${player.level}! All stats increased!`
    }
  }
}

// ═══════════════════════════════════════════════════════
//  COMBAT MATH
// ═══════════════════════════════════════════════════════
function physDmg(atk, def) {
  return Math.max(1, atk - def + Math.floor(Math.random() * 5) - 1)
}

function magDmg(magAtk, spell, ignoreDef) {
  const v = Math.floor(Math.random() * 8)
  const base = spell.baseDmg + Math.floor(magAtk * 0.6) + v
  return Math.max(1, ignoreDef ? base : base)
}

function enemyChooseAction(enemy) {
  if (enemy.statusEffect === "frozen") return { type:"stunned" }
  if (enemy.spells.length > 0 && enemy.mp >= 5 && Math.random() < 0.4) {
    const castable = enemy.spells.filter(sk => SPELLS[sk] && enemy.mp >= SPELLS[sk].mp)
    if (castable.length > 0) {
      const sk = castable[Math.floor(Math.random() * castable.length)]
      return { type:"spell", spellKey:sk, spell:SPELLS[sk] }
    }
  }
  return { type:"attack" }
}

function resolveEnemyTurn(enemy, player, gs) {
  const action = enemyChooseAction(enemy)
  const logs = []

  if (action.type === "stunned") {
    enemy.statusEffect = null
    logs.push(`${enemy.name} is thawing out!`)
    return logs
  }

  if (action.type === "spell") {
    const sp = action.spell
    enemy.mp = Math.max(0, enemy.mp - sp.mp)
    const dmg = magDmg(enemy.atk, sp, false)
    player.hp = Math.max(0, player.hp - dmg)
    logs.push(`${enemy.name} cast ${sp.name}!`)
    logs.push(`You took ${dmg} magic damage!`)
    if (sp.type === "ice"  && Math.random() < 0.35) { player.statusEffect="frozen"; player.statusTimer=1; logs.push("You are FROZEN!") }
    if (sp.type === "fire" && Math.random() < 0.4)  { player.statusEffect="burn";   player.statusTimer=3; logs.push("You are BURNING!") }
    return logs
  }

  const dmg = physDmg(enemy.atk, player.def)
  player.hp = Math.max(0, player.hp - dmg)
  logs.push(`${enemy.name} attacks! -${dmg} HP`)
  return logs
}

// ═══════════════════════════════════════════════════════
//  /progression — dungeonProgression
//  Floor transition, stat bonuses, state reset
// ═══════════════════════════════════════════════════════
const DungeonProgression = {
  /**
   * Descend to next floor:
   * - Generate fresh dungeon (old one freed)
   * - Keep all player stats + inventory
   * - Increase floor counter
   * - Apply any floor-clear bonus
   * - Track highestFloor stat
   */
  descend(gs) {
    gs.floor++
    gs.player.floorsCleared++
    gs.player.highestFloor = Math.max(gs.player.highestFloor, gs.floor)

    // Apply every-N-floor bonus to keep player competitive
    const bonus = DifficultyScaling.floorClearBonus(gs.floor)
    if (bonus) {
      gs.player.maxHp  += bonus.hp
      gs.player.maxMp  += bonus.mp
      gs.player.atk    += bonus.atk
      gs.player.def    += bonus.def
      gs.player.magAtk += bonus.magAtk
      gs.player.hp      = gs.player.maxHp  // full heal on bonus
      gs.player.mp      = gs.player.maxMp
      gs.floorBonusMsg  = `Floor ${gs.floor} bonus! +${bonus.hp}HP +${bonus.atk}ATK`
    }

    // Fresh dungeon — previous floor GC'd
    const { tiles, rooms, items } = generateDungeon(gs.floor)
    const sr = rooms[0]
    gs.tiles   = tiles
    gs.rooms   = rooms
    gs.items   = items
    gs.enemies = spawnEnemies(rooms, gs.floor)

    // Place player in start room
    gs.player.x = sr.cx
    gs.player.y = sr.cy

    const isBoss = DifficultyScaling.isBossFloor(gs.floor)
    gs.message = isBoss
      ? `⚠ FLOOR ${gs.floor} — BOSS FLOOR! Prepare yourself!`
      : `Floor ${gs.floor} — The darkness deepens...`

    gs.screen = "explore"
  },
}

// ═══════════════════════════════════════════════════════
//  SVG SPRITE RENDERERS  (pure string functions)
// ═══════════════════════════════════════════════════════
const SVG = {
  wall(x, y, wt) {
    const c  = wt || C.darkBlue
    const hi = wt ? lightenHex(wt, 20) : C.wallEdge
    const mid= wt ? lightenHex(wt, 10) : C.midBlue
    return `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" fill="${c}"/>` +
      `<rect x="${x}" y="${y}" width="${TILE}" height="1" fill="${hi}"/>` +
      `<rect x="${x}" y="${y}" width="1" height="${TILE}" fill="${hi}"/>` +
      `<rect x="${x+2}" y="${y+2}" width="5" height="3" fill="${mid}"/>` +
      `<rect x="${x+9}" y="${y+2}" width="5" height="3" fill="${mid}"/>` +
      `<rect x="${x+4}" y="${y+8}" width="6" height="3" fill="${mid}"/>` +
      `<rect x="${x+1}" y="${y+8}" width="2" height="3" fill="${mid}"/>`
  },

  floor(x, y, alt, ft) {
    const f = ft ? (alt ? lightenHex(ft,4) : ft) : (alt ? C.floorAlt : C.floor)
    return `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" fill="${f}"/>` +
      `<rect x="${x+1}" y="${y+1}" width="1" height="1" fill="#ffffff07"/>` +
      `<rect x="${x+TILE-2}" y="${y+TILE-2}" width="1" height="1" fill="#00000018"/>`
  },

  stairs(x, y) {
    return `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" fill="${C.stairs}"/>` +
      [12,9,6,3].map((sy,i)=>
        `<rect x="${x+2+i*2}" y="${y+sy}" width="${TILE-4-i*4}" height="2" fill="${C.stairsHi}"/>`
      ).join("") +
      `<rect x="${x+7}" y="${y+7}" width="2" height="2" fill="#88ff8844"/>`
  },

  item(x, y, type) {
    const it  = ITEMS[type]
    const col = it?.color || C.gold
    const rc  = RARITY_COLOR[it?.rarity] || C.silver
    return `<rect x="${x+3}" y="${y+5}" width="10" height="8" fill="${col}" opacity="0.85"/>` +
      `<rect x="${x+2}" y="${y+4}" width="12" height="2" fill="${rc}"/>` +
      `<rect x="${x+5}" y="${y+2}" width="6" height="3" fill="${rc}"/>` +
      `<rect x="${x+3}" y="${y+5}" width="3" height="3" fill="#ffffff22"/>` +
      `<rect x="${x+3}" y="${y+13}" width="10" height="1" fill="${col}" opacity="0.3"/>`
  },

  player(x, y, face, frame, status) {
    const bob = frame % 2
    const fl  = face < 0
      ? `transform="translate(${x+TILE},${y}) scale(-1,1)"`
      : `transform="translate(${x},${y})"`
    const col   = status === "frozen" ? C.ice    : C.player
    const colDk = status === "frozen" ? "#4488bb" : C.playerDk
    const burn  = status === "burn"
    return `<g ${fl}>` +
      `<rect x="5" y="${5+bob}" width="6" height="7" fill="${col}"/>` +
      `<rect x="4" y="${1+bob}" width="8" height="7" fill="${col}"/>` +
      `<rect x="6" y="${3+bob}" width="2" height="2" fill="${C.black}"/>` +
      `<rect x="9" y="${3+bob}" width="2" height="2" fill="${C.black}"/>` +
      `<rect x="11" y="${5+bob}" width="4" height="2" fill="${colDk}"/>` +
      `<rect x="14" y="${4+bob}" width="2" height="5" fill="${C.gold}"/>` +
      `<rect x="15" y="${3+bob}" width="1" height="2" fill="${C.textBright}"/>` +
      `<rect x="5" y="${12+bob}" width="2" height="3" fill="${colDk}"/>` +
      `<rect x="9" y="${12+bob}" width="2" height="3" fill="${colDk}"/>` +
      (burn ? `<rect x="5" y="${bob}" width="2" height="3" fill="${C.fire}" opacity="0.9"/>` +
              `<rect x="9" y="${-1+bob}" width="2" height="4" fill="${C.fire}" opacity="0.9"/>` : "") +
      `</g>`
  },

  enemy(x, y, face, frame, type, status) {
    const t   = ENEMY_TEMPLATES[type] || ENEMY_TEMPLATES.goblin
    const col = t.color, colDk = t.colorDk
    const bob = frame % 2
    const fl  = face > 0
      ? `transform="translate(${x+TILE},${y}) scale(-1,1)"`
      : `transform="translate(${x},${y})"`

    let crown = ""
    if (t.rarity === "boss") {
      crown = `<rect x="2" y="${-3+bob}" width="12" height="1" fill="${C.gold}"/>` +
              `<rect x="3" y="${-5+bob}" width="2" height="3" fill="${C.gold}"/>` +
              `<rect x="7" y="${-6+bob}" width="2" height="4" fill="${C.gold}"/>` +
              `<rect x="11" y="${-5+bob}" width="2" height="3" fill="${C.gold}"/>` +
              `<rect x="2" y="${-4+bob}" width="12" height="2" fill="${C.gold}" opacity="0.5"/>`
    } else if (t.rarity === "elite") {
      crown = `<rect x="5" y="${-2+bob}" width="6" height="2" fill="${C.eElite}"/>` +
              `<rect x="6" y="${-3+bob}" width="1" height="2" fill="${C.eElite}"/>` +
              `<rect x="9" y="${-3+bob}" width="1" height="2" fill="${C.eElite}"/>`
    } else if (t.rarity === "rare") {
      crown = `<rect x="4" y="${-1+bob}" width="8" height="1" fill="${C.eRare}" opacity="0.8"/>`
    }

    const frozen = status === "frozen"
      ? `<rect x="2" y="${0+bob}" width="12" height="14" fill="${C.ice}" opacity="0.25"/>`
      : ""

    return `<g ${fl}>${crown}` +
      `<rect x="4" y="${6+bob}" width="8" height="7" fill="${colDk}"/>` +
      `<rect x="3" y="${1+bob}" width="10" height="8" fill="${col}"/>` +
      `<rect x="5" y="${3+bob}" width="2" height="2" fill="${C.black}"/>` +
      `<rect x="9" y="${3+bob}" width="2" height="2" fill="${C.black}"/>` +
      `<rect x="5" y="${7+bob}" width="2" height="2" fill="${C.textBright}"/>` +
      `<rect x="9" y="${7+bob}" width="2" height="2" fill="${C.textBright}"/>` +
      `<rect x="1" y="${5+bob}" width="3" height="2" fill="${col}"/>` +
      `<rect x="12" y="${5+bob}" width="3" height="2" fill="${col}"/>` +
      `<rect x="4" y="${13+bob}" width="2" height="3" fill="${colDk}"/>` +
      `<rect x="10" y="${13+bob}" width="2" height="3" fill="${colDk}"/>` +
      frozen + `</g>`
  },
}

// Lightweight hex brightener (for tinted walls)
function lightenHex(hex, amt) {
  const n = parseInt(hex.slice(1),16)
  const r = Math.min(255, ((n>>16)&0xff)+amt)
  const g = Math.min(255, ((n>>8)&0xff)+amt)
  const b = Math.min(255, (n&0xff)+amt)
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`
}

// ═══════════════════════════════════════════════════════
//  WORLD RENDERER  (imperative SVG innerHTML)
// ═══════════════════════════════════════════════════════
function renderExplore(svgEl, gs) {
  if (!svgEl) return
  const p    = gs.player
  const camX = Math.max(0, Math.min(MAP_W-VIEW_W, p.x - Math.floor(VIEW_W/2)))
  const camY = Math.max(0, Math.min(MAP_H-VIEW_H, p.y - Math.floor(VIEW_H/2)))
  gs._camX = camX; gs._camY = camY

  const ft = DifficultyScaling.floorTint(gs.floor)
  const wt = DifficultyScaling.wallTint(gs.floor)

  let html = ""

  // 1. TILES
  for (let ty = camY; ty < camY+VIEW_H; ty++) {
    for (let tx = camX; tx < camX+VIEW_W; tx++) {
      const sx = (tx-camX)*TILE, sy = (ty-camY)*TILE
      const t  = gs.tiles[ty]?.[tx] ?? T_WALL
      if      (t === T_WALL)   html += SVG.wall(sx, sy, wt)
      else if (t === T_STAIRS) html += SVG.stairs(sx, sy)
      else {
        html += SVG.floor(sx, sy, (tx+ty)%2, ft)
        if (t === T_ITEM) {
          const it = gs.items.find(i => i.x===tx && i.y===ty)
          if (it) html += SVG.item(sx, sy, it.type)
        }
      }
    }
  }

  // 2. ENEMIES (only visible ones)
  gs.enemies.forEach(e => {
    const sx = (e.x-camX)*TILE, sy = (e.y-camY)*TILE
    if (sx < -TILE || sx > CW || sy < -TILE || sy > CH) return
    html += SVG.enemy(sx, sy, e.face, Math.floor(e.animFrame/2), e.type, e.statusEffect)

    // HP bar
    const pct = e.hp/e.maxHp
    const bc  = pct > 0.5 ? C.hpGreen : pct > 0.25 ? C.hpYellow : C.hpRed
    html += `<rect x="${sx}" y="${sy-5}" width="${TILE}" height="2" fill="#080808"/>` +
            `<rect x="${sx}" y="${sy-5}" width="${Math.round(TILE*pct)}" height="2" fill="${bc}"/>`

    // Enemy level label — retro small text
    const lvColor = e.rarity==="boss" ? C.eBoss : e.rarity==="elite" ? C.eElite : e.rarity==="rare" ? C.eRare : C.textDim
    html += `<text x="${sx+8}" y="${sy-7}" font-family="monospace" font-size="5" fill="${lvColor}" text-anchor="middle">Lv${e.level}</text>`
  })

  // 3. PLAYER
  {
    const sx = (p.x-camX)*TILE, sy = (p.y-camY)*TILE
    html += SVG.player(sx, sy, p.face, Math.floor(p.animFrame/2), p.statusEffect)
  }

  svgEl.innerHTML = html
}

// ═══════════════════════════════════════════════════════
//  MOVEMENT SYSTEM
// ═══════════════════════════════════════════════════════
function movePlayer(gs, dir) {
  if (gs.screen !== "explore") return
  const p   = gs.player
  const map = {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}
  const [dx,dy] = map[dir] || [0,0]
  if (!dx && !dy) return

  if (dx > 0) p.face = 1
  if (dx < 0) p.face = -1

  // Status: frozen blocks move for 1 turn
  if (p.statusEffect === "frozen") {
    p.statusEffect = null
    gs.message = "You thaw out!"
    return
  }

  const nx = p.x+dx, ny = p.y+dy
  if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) return
  const t = gs.tiles[ny]?.[nx]
  if (t === T_WALL || t === undefined) return

  // Enemy encounter → battle
  const hit = gs.enemies.find(e => e.x===nx && e.y===ny)
  if (hit) {
    gs.currentEnemy = hit
    gs.screen       = "battle"
    gs.battleLog    = [`A Lv${hit.level} ${hit.name} appears!`]
    gs.battleTurn   = "player"
    gs.battleMenu   = "main"
    return
  }

  p.x = nx; p.y = ny
  p.animTimer++
  if (p.animTimer >= 2) { p.animFrame++; p.animTimer = 0 }

  // Item pickup
  if (t === T_ITEM) {
    const idx = gs.items.findIndex(i => i.x===nx && i.y===ny)
    if (idx >= 0) {
      gs.pickedItem = gs.items[idx]
      gs.items.splice(idx, 1)
      gs.tiles[ny][nx] = T_FLOOR
      gs.screen = "item"
      return
    }
  }

  // Stairs — descend
  if (t === T_STAIRS) {
    DungeonProgression.descend(gs)
    return
  }

  // Burn tick while walking
  if (p.statusEffect === "burn") {
    p.hp = Math.max(0, p.hp - 2)
    p.statusTimer--
    if (p.statusTimer <= 0) p.statusEffect = null
    if (p.hp <= 0) { gs.screen = "gameover" }
  }

  // Enemy wander (lightweight — only when player moves)
  gs.enemies.forEach(e => {
    e.animTimer++
    if (e.animTimer >= 3) { e.animFrame++; e.animTimer = 0 }
    // Simple wander: 30% chance to move each player step
    if (Math.random() < 0.3) {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]]
      const d    = dirs[Math.floor(Math.random()*4)]
      const ex   = e.x+d[0], ey = e.y+d[1]
      const et   = gs.tiles[ey]?.[ex]
      if (et && et !== T_WALL && !gs.enemies.some(o => o!==e && o.x===ex && o.y===ey)) {
        e.x=ex; e.y=ey
        if (d[0]>0) e.face=1; if (d[0]<0) e.face=-1
      }
    }
  })
}

// ═══════════════════════════════════════════════════════
//  BATTLE ACTION SYSTEM
// ═══════════════════════════════════════════════════════
function battleAction(gs, action) {
  const p = gs.player
  const e = gs.currentEnemy
  if (!e || gs.screen !== "battle") return

  let logs = []
  let doEnemyTurn = true

  // Frozen player skips turn
  if (p.statusEffect === "frozen") {
    logs.push("You are FROZEN and can't act!")
    p.statusEffect = null
    doEnemyTurn = true
  }

  else if (action.type === "attack") {
    const dmg = physDmg(p.atk, e.def)
    e.hp = Math.max(0, e.hp - dmg)
    logs.push(`You strike ${e.name}!`)
    logs.push(`Dealt ${dmg} damage! (Lv${e.level})`)

  } else if (action.type === "spell") {
    const sp = SPELLS[action.spellKey]
    if (!sp || p.mp < sp.mp) { logs.push("Not enough MP!"); doEnemyTurn = false }
    else {
      p.mp -= sp.mp
      if (sp.type === "heal") {
        const amt = Math.floor(p.maxHp * 0.35)
        p.hp = Math.min(p.maxHp, p.hp + amt)
        logs.push(`CURE heals ${amt} HP!`)
        doEnemyTurn = true
      } else {
        const ignoreDef = sp.type === "thunder"
        const dmg = magDmg(p.magAtk, sp, ignoreDef)
        const actualDmg = ignoreDef ? dmg : Math.max(1, dmg - Math.floor(e.def * 0.5))
        e.hp = Math.max(0, e.hp - actualDmg)
        logs.push(`You cast ${sp.name}! (${actualDmg} dmg)`)
        if (sp.type === "ice" && Math.random() < 0.45) { e.statusEffect="frozen"; e.statusTimer=1; logs.push(`${e.name} is FROZEN!`) }
        if (sp.type === "fire" && Math.random() < 0.4) { e.statusEffect="burn";   e.statusTimer=3; logs.push(`${e.name} is BURNING!`) }
        if (sp.type === "dark") { const drain=Math.floor(actualDmg*0.3); p.hp=Math.min(p.maxHp,p.hp+drain); logs.push(`Drained ${drain} HP!`) }
      }
    }

  } else if (action.type === "heal") {
    const cost = 8
    if (p.mp < cost) { logs.push("Need 8 MP to heal!"); doEnemyTurn = false }
    else {
      p.mp -= cost
      const amt = Math.floor(p.maxHp * 0.28)
      p.hp = Math.min(p.maxHp, p.hp + amt)
      logs.push(`You heal ${amt} HP!`)
    }

  } else if (action.type === "useItem") {
    const it = ITEMS[action.itemKey]
    if (!it) { doEnemyTurn = false }
    else {
      const idx = p.inventory.indexOf(action.itemKey)
      if (idx < 0) { logs.push("No items!"); doEnemyTurn = false }
      else {
        p.inventory.splice(idx, 1)
        it.use(p, action.itemKey, gs)
        logs.push(`Used ${it.name}! ${it.desc}`)
      }
    }

  } else if (action.type === "run") {
    // Run chance: base 50% − penalty for elite/boss
    const runChance = e.rarity === "boss" ? 0.1 : e.rarity === "elite" ? 0.3 : 0.55
    if (Math.random() < runChance) {
      logs.push("Fled successfully!")
      gs.screen = "explore"; gs.currentEnemy = null
      gs.battleLog = logs
      return
    } else {
      logs.push("Couldn't escape!")
    }
  }

  // Check enemy death
  if (gs.screen === "battle" && e.hp <= 0) {
    logs.push(`${e.name} defeated!`)
    logs.push(`+${e.xp} XP  +${e.gold}G`)
    p.xp += e.xp; p.gold += e.gold; p.totalGold += e.gold
    p.enemiesDefeated++
    gs.enemies = gs.enemies.filter(en => en !== e)
    gs.currentEnemy = null
    gs.screen = "explore"
    checkLevelUp(p, gs)
    if (gs.pendingLevelUp) { gs.screen = "levelup"; gs.pendingLevelUp = false }
    gs.battleLog = logs
    return
  }

  // Enemy turn
  if (doEnemyTurn && gs.screen === "battle" && gs.currentEnemy) {
    // Burn tick on enemy
    if (e.statusEffect === "burn") {
      const bd = 3
      e.hp = Math.max(0, e.hp - bd)
      e.statusTimer--
      if (e.statusTimer <= 0) e.statusEffect = null
      logs.push(`${e.name} burns! -${bd} HP`)
      if (e.hp <= 0) {
        logs.push(`${e.name} burned to death!`)
        p.xp += e.xp; p.gold += e.gold; p.totalGold += e.gold; p.enemiesDefeated++
        gs.enemies = gs.enemies.filter(en => en !== e)
        gs.currentEnemy = null; gs.screen = "explore"
        checkLevelUp(p, gs)
        if (gs.pendingLevelUp) { gs.screen="levelup"; gs.pendingLevelUp=false }
        gs.battleLog = logs; return
      }
    }

    const eLogs = resolveEnemyTurn(e, p, gs)
    logs = [...logs, ...eLogs]
    if (p.hp <= 0) { gs.screen = "gameover" }
  }

  gs.battleLog = logs.slice(-3)
  gs.battleMenu = "main"
}

// ═══════════════════════════════════════════════════════
//  INPUT SYSTEM
// ═══════════════════════════════════════════════════════
function createInput() {
  const held={}, handlers={}, repeats={}
  const DELAY=185, INTERVAL=110
  const K={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right",
            w:"up",s:"down",a:"left",d:"right",W:"up",S:"down",A:"left",D:"right"}
  return {
    handlers,
    onKeyDown(key) {
      const dir=K[key]; if(!dir||held[dir]) return
      held[dir]=true; handlers[dir]?.()
      repeats[dir]={delay:DELAY,interval:0}
    },
    onKeyUp(key) {
      const dir=K[key]; if(!dir) return
      held[dir]=false; delete repeats[dir]
    },
    tick(dt) {
      Object.keys(repeats).forEach(dir=>{
        if(!held[dir]){delete repeats[dir];return}
        repeats[dir].delay-=dt
        if(repeats[dir].delay>0) return
        repeats[dir].interval-=dt
        if(repeats[dir].interval<=0){repeats[dir].interval=INTERVAL;handlers[dir]?.()}
      })
    }
  }
}

// ═══════════════════════════════════════════════════════
//  GAME STATE INITIALIZER
// ═══════════════════════════════════════════════════════
function newGame() {
  const floor = 1
  const {tiles,rooms,items} = generateDungeon(floor)
  const sr = rooms[0]
  return {
    screen: "explore",
    floor,
    tiles, rooms, items,
    player: createPlayer(sr.cx, sr.cy),
    enemies: spawnEnemies(rooms, floor),
    currentEnemy: null,
    battleLog: [],
    battleMenu: "main",
    pendingLevelUp: false,
    levelUpMessage: "",
    pickedItem: null,
    message: "FLOOR 1 — Find the stairs to descend!",
    floorBonusMsg: null,
  }
}

// ═══════════════════════════════════════════════════════
//  PIXEL FONT STYLE
// ═══════════════════════════════════════════════════════
const PX = {fontFamily:"'Courier New',Courier,monospace",imageRendering:"pixelated"}

const btnStyle = (active, accentColor) => ({
  ...PX,
  background: active ? (accentColor||C.uiBorder) : C.uiBox,
  border: `2px solid ${active ? (accentColor||C.uiBorder) : C.uiBorder}`,
  color:  active ? C.black : C.textBright,
  padding:"5px 7px", cursor:"pointer", fontSize:9,
  letterSpacing:1, outline:"none", display:"block", width:"100%",
  textAlign:"left",
})

// ═══════════════════════════════════════════════════════
//  HP / MP BAR
// ═══════════════════════════════════════════════════════
function Bar({cur,max,color,w=70,h=5}) {
  const pct = Math.max(0,cur/max)
  const bc  = color || (pct>.5?C.hpGreen:pct>.25?C.hpYellow:C.hpRed)
  return (
    <div style={{width:w,height:h,background:"#060608",border:`1px solid ${C.uiBorder}33`,display:"inline-block",verticalAlign:"middle"}}>
      <div style={{width:`${pct*100}%`,height:"100%",background:bc,transition:"width .12s"}}/>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════════════
function HUD({player,floor,message}) {
  const isBoss = DifficultyScaling.isBossFloor(floor)
  const xpPct  = player.xp/player.xpNext
  return (
    <div style={{
      position:"absolute",top:0,left:0,right:0,zIndex:10,
      background:C.uiBg, borderBottom:`2px solid ${isBoss?C.eBoss:C.uiBorder}`,
      padding:"3px 8px", display:"flex", alignItems:"center",
      gap:8, ...PX, fontSize:9, pointerEvents:"none", flexWrap:"wrap",
    }}>
      <div style={{display:"flex",alignItems:"center",gap:3}}>
        <span style={{color:C.hpRed,fontSize:8}}>HP</span>
        <Bar cur={player.hp} max={player.maxHp} w={50} h={5}/>
        <span style={{color:C.textBright,fontSize:8}}>{player.hp}/{player.maxHp}</span>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:3}}>
        <span style={{color:C.mpBlue,fontSize:8}}>MP</span>
        <Bar cur={player.mp} max={player.maxMp} color={C.mpBlue} w={40} h={5}/>
        <span style={{color:C.textBright,fontSize:8}}>{player.mp}/{player.maxMp}</span>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:3}}>
        <span style={{color:C.xpPurple,fontSize:8}}>XP</span>
        <Bar cur={player.xp} max={player.xpNext} color={C.xpPurple} w={32} h={4}/>
      </div>
      <span style={{color:C.textDim,fontSize:8}}>Lv<span style={{color:C.gold}}>{player.level}</span></span>
      <span style={{color:C.textDim,fontSize:8}}>ATK<span style={{color:C.textRed}}>{player.atk}</span></span>
      <span style={{color:C.textDim,fontSize:8}}>DEF<span style={{color:C.silver}}>{player.def}</span></span>
      <span style={{color:C.gold,fontSize:8}}>{player.gold}G</span>
      {player.statusEffect && <span style={{color:player.statusEffect==="frozen"?C.ice:C.fire,fontSize:8}}>[{player.statusEffect.toUpperCase()}]</span>}
      <div style={{flex:1,textAlign:"center",color:isBoss?C.eBoss:C.textGold,fontSize:9,overflow:"hidden",whiteSpace:"nowrap",letterSpacing:1}}>
        {message}
      </div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:1}}>
        <span style={{color:isBoss?C.eBoss:C.textBright,fontWeight:"bold",fontSize:10}}>
          {isBoss?"⚠ ":""}B{floor}
        </span>
        <span style={{color:C.textDim,fontSize:7}}>BEST:{player.highestFloor}</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  BATTLE SCREEN  (Pokemon Red layout)
// ═══════════════════════════════════════════════════════
function BattleScreen({gs, onAction}) {
  const p = gs.player
  const e = gs.currentEnemy
  if (!e) return null

  const [menu,setMenu]   = useState("main")
  const [frame,setFrame] = useState(0)
  const [shake,setShake] = useState("")  // "enemy"|"player"|""

  useEffect(()=>{
    const t = setInterval(()=>setFrame(f=>f+1),380)
    return ()=>clearInterval(t)
  },[])

  // Close sub-menus when battle log changes
  useEffect(()=>{ setMenu("main") },[gs.battleLog])

  const doAction = useCallback((action)=>{
    const isAttack = action.type==="attack"||action.type==="spell"
    if (isAttack) setShake("enemy")
    if (action.type==="useItem"||action.type==="heal") setShake("player")
    setTimeout(()=>setShake(""),150)
    onAction(action)
  },[onAction])

  const eHpPct = e.hp/e.maxHp
  const rarityColor = e.rarity==="boss"?C.eBoss:e.rarity==="elite"?C.eElite:e.rarity==="rare"?C.eRare:C.textDim
  const isBoss = e.rarity === "boss"

  return (
    <div style={{
      position:"absolute",inset:0,background:C.black,
      display:"flex",flexDirection:"column",...PX,zIndex:20,
    }}>
      {/* ── ARENA ── */}
      <div style={{
        flex:1,display:"flex",alignItems:"flex-end",justifyContent:"space-between",
        padding:"10px 20px 6px",position:"relative",overflow:"hidden",
        background:`linear-gradient(180deg,${DifficultyScaling.wallTint(gs.floor)} 0%,${DifficultyScaling.floorTint(gs.floor)} 100%)`,
        borderBottom:`3px solid ${isBoss?C.eBoss:C.uiBorder}`,
      }}>
        {/* Scanline overlay */}
        <div style={{position:"absolute",inset:0,backgroundImage:`repeating-linear-gradient(0deg,#00000011 0,#00000011 1px,transparent 1px,transparent 3px)`,pointerEvents:"none"}}/>

        {/* Enemy info (top-left style like Pokémon) */}
        <div style={{display:"flex",flexDirection:"column",gap:3,minWidth:140,zIndex:1}}>
          <div style={{fontSize:11,color:C.textBright,letterSpacing:1}}>
            {e.name}
            <span style={{color:rarityColor,fontSize:9,marginLeft:6}}>
              {e.rarity==="boss"?"★BOSS":e.rarity==="elite"?"◆ELITE":e.rarity==="rare"?"◇RARE":""}
            </span>
          </div>
          <div style={{fontSize:9,color:rarityColor}}>Lv {e.level}</div>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{color:C.textDim,fontSize:8}}>HP</span>
            <Bar cur={e.hp} max={e.maxHp} w={100} h={6}/>
            <span style={{color:C.textBright,fontSize:8}}>{e.hp}/{e.maxHp}</span>
          </div>
          {e.mp>0 && (
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{color:C.textDim,fontSize:8}}>MP</span>
              <Bar cur={e.mp} max={e.maxMp} color={C.mpBlue} w={80} h={4}/>
            </div>
          )}
          {e.statusEffect && (
            <div style={{fontSize:8,color:e.statusEffect==="frozen"?C.ice:C.fire,letterSpacing:1}}>
              [{e.statusEffect.toUpperCase()}]
            </div>
          )}
        </div>

        {/* Enemy sprite */}
        <div style={{zIndex:1}}>
          <svg width={isBoss?64:48} height={isBoss?72:56}
            viewBox={`-2 -8 ${TILE+4} ${TILE+12}`}
            style={{imageRendering:"pixelated",
              filter:shake==="enemy"?"brightness(4)":"none",
              transform:shake==="enemy"?"translateX(5px)":"none",
              transition:"transform .06s"
            }}>
            <g dangerouslySetInnerHTML={{__html:SVG.enemy(0,0,-1,frame%2,e.type,e.statusEffect)}}/>
          </svg>
        </div>

        {/* Player sprite (bottom-right like Pokémon) */}
        <div style={{zIndex:1,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:4}}>
          <svg width={48} height={56} viewBox={`-2 -4 ${TILE+4} ${TILE+8}`}
            style={{imageRendering:"pixelated",
              filter:shake==="player"?"brightness(4)":"none",
              transform:shake==="player"?"translateX(-4px)":"none",
              transition:"transform .06s"
            }}>
            <g dangerouslySetInnerHTML={{__html:SVG.player(0,0,1,frame%2,p.statusEffect)}}/>
          </svg>
          <div style={{fontSize:8,color:C.textDim,letterSpacing:1}}>HERO Lv{p.level}</div>
        </div>

        {/* Player stats (bottom-left Pokémon style) */}
        <div style={{display:"flex",flexDirection:"column",gap:3,minWidth:130,zIndex:1}}>
          <div style={{fontSize:10,color:C.textBright,letterSpacing:1}}>HERO</div>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{color:C.textDim,fontSize:8}}>HP</span>
            <Bar cur={p.hp} max={p.maxHp} w={90} h={6}/>
            <span style={{color:C.textBright,fontSize:8}}>{p.hp}/{p.maxHp}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{color:C.textDim,fontSize:8}}>MP</span>
            <Bar cur={p.mp} max={p.maxMp} color={C.mpBlue} w={80} h={5}/>
            <span style={{color:C.textBright,fontSize:8}}>{p.mp}/{p.maxMp}</span>
          </div>
          {p.statusEffect && (
            <div style={{fontSize:8,color:p.statusEffect==="frozen"?C.ice:C.fire}}>[{p.statusEffect.toUpperCase()}]</div>
          )}
        </div>
      </div>

      {/* ── LOG + MENU (Pokémon Red bottom panel) ── */}
      <div style={{background:C.uiBg,borderTop:`3px solid ${isBoss?C.eBoss:C.uiBorder}`,display:"flex",minHeight:112}}>

        {/* Battle log */}
        <div style={{
          flex:1,padding:"8px 12px",borderRight:`2px solid ${C.uiBorder}`,
          display:"flex",flexDirection:"column",justifyContent:"flex-end",gap:3,
        }}>
          {(gs.battleLog||[]).slice(-3).map((line,i,arr)=>(
            <div key={i} style={{
              fontSize:10,letterSpacing:0.5,
              color:i===arr.length-1?C.textBright:C.textDim,
            }}>{line}</div>
          ))}
        </div>

        {/* Battle menu */}
        <div style={{width:190,padding:8,display:"flex",flexDirection:"column",gap:3}}>

          {menu==="main" && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
              {[
                {label:"⚔ ATTACK",  act:()=>doAction({type:"attack"}),     color:C.eNormal},
                {label:"✦ MAGIC",   act:()=>setMenu("spells"),              color:C.mpBlue },
                {label:"♥ HEAL",    act:()=>doAction({type:"heal"}),        color:C.hpGreen},
                {label:"⊞ ITEMS",   act:()=>setMenu("items"),               color:C.gold   },
                {label:"↩ RUN",     act:()=>doAction({type:"run"}),         color:C.textDim},
                {label:"? INFO",    act:()=>setMenu("info"),                 color:C.textDim},
              ].map(b=>(
                <button key={b.label} style={btnStyle(false)}
                  onClick={b.act}
                  onMouseEnter={e=>e.target.style.background=b.color||C.uiBorder}
                  onMouseLeave={e=>e.target.style.background=C.uiBox}>
                  {b.label}
                </button>
              ))}
            </div>
          )}

          {menu==="spells" && (
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <div style={{fontSize:8,color:C.textGold,letterSpacing:2,marginBottom:2}}>─ MAGIC ─</div>
              {p.spells.length===0 && <div style={{fontSize:9,color:C.textDim}}>No spells known.</div>}
              {p.spells.map(sk=>{
                const sp=SPELLS[sk]; if(!sp) return null
                const ok=p.mp>=sp.mp
                return (
                  <button key={sk} disabled={!ok}
                    style={{...btnStyle(false),opacity:ok?1:0.4,fontSize:9}}
                    onClick={()=>ok&&doAction({type:"spell",spellKey:sk})}
                    onMouseEnter={e=>{if(ok)e.target.style.background=sp.color}}
                    onMouseLeave={e=>e.target.style.background=C.uiBox}>
                    {sp.name} <span style={{color:C.mpBlue,fontSize:8}}>MP:{sp.mp}</span>
                    {sp.type==="heal"?<span style={{color:C.heal,fontSize:8}}> ♥</span>:null}
                  </button>
                )
              })}
              <button style={{...btnStyle(false),fontSize:9,marginTop:2}} onClick={()=>setMenu("main")}>← BACK</button>
            </div>
          )}

          {menu==="items" && (
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <div style={{fontSize:8,color:C.textGold,letterSpacing:2,marginBottom:2}}>─ ITEMS ─</div>
              {p.inventory.length===0 && <div style={{fontSize:9,color:C.textDim}}>Bag is empty.</div>}
              {[...new Set(p.inventory)].slice(0,4).map(ik=>{
                const it=ITEMS[ik]; if(!it) return null
                const count=p.inventory.filter(i=>i===ik).length
                return (
                  <button key={ik} style={{...btnStyle(false),fontSize:9}}
                    onClick={()=>doAction({type:"useItem",itemKey:ik})}
                    onMouseEnter={e=>e.target.style.background=C.uiBorder}
                    onMouseLeave={e=>e.target.style.background=C.uiBox}>
                    <span style={{color:it.color}}>{it.name}</span>
                    {count>1&&<span style={{color:C.textDim,fontSize:8}}> ×{count}</span>}
                  </button>
                )
              })}
              <button style={{...btnStyle(false),fontSize:9,marginTop:2}} onClick={()=>setMenu("main")}>← BACK</button>
            </div>
          )}

          {menu==="info" && (
            <div style={{display:"flex",flexDirection:"column",gap:3,fontSize:9}}>
              <div style={{color:rarityColor,fontSize:10,letterSpacing:1}}>{e.name}</div>
              <div style={{color:C.textDim}}>Level: <span style={{color:C.textBright}}>{e.level}</span></div>
              <div style={{color:C.textDim}}>ATK: <span style={{color:C.textRed}}>{e.atk}</span>  DEF: <span style={{color:C.silver}}>{e.def}</span></div>
              <div style={{color:C.textDim}}>XP: <span style={{color:C.xpPurple}}>{e.xp}</span>  Gold: <span style={{color:C.gold}}>{e.gold}</span></div>
              {e.spells.length>0 && <div style={{color:C.textDim}}>Magic: <span style={{color:C.mpBlue}}>{e.spells.map(s=>SPELLS[s]?.name).join(", ")}</span></div>}
              <button style={{...btnStyle(false),fontSize:9,marginTop:4}} onClick={()=>setMenu("main")}>← BACK</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  LEVEL UP SCREEN
// ═══════════════════════════════════════════════════════
function LevelUpScreen({player, message, onContinue}) {
  return (
    <div style={{
      position:"absolute",inset:0,background:"#000000e8",
      display:"flex",alignItems:"center",justifyContent:"center",
      zIndex:30,...PX,
    }}>
      <div style={{
        background:C.uiBg,border:`3px solid ${C.gold}`,
        padding:20,textAlign:"center",minWidth:220,
      }}>
        <div style={{color:C.gold,fontSize:16,letterSpacing:4,marginBottom:6}}>★ LEVEL UP ★</div>
        <div style={{color:C.textBright,fontSize:10,marginBottom:14,letterSpacing:1}}>{message}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:16,fontSize:9}}>
          {[
            ["HP",   `${player.hp}/${player.maxHp}`, C.hpGreen ],
            ["MP",   `${player.mp}/${player.maxMp}`, C.mpBlue  ],
            ["ATK",  player.atk,   C.textRed  ],
            ["DEF",  player.def,   C.silver   ],
            ["MATK", player.magAtk,C.xpPurple ],
            ["LVL",  player.level, C.gold     ],
          ].map(([k,v,c])=>(
            <div key={k} style={{background:C.uiBox,border:`1px solid ${C.uiBorder}`,padding:"4px 6px"}}>
              <span style={{color:C.textDim}}>{k} </span>
              <span style={{color:c}}>{v}</span>
            </div>
          ))}
        </div>
        <button style={{...btnStyle(true,C.gold),textAlign:"center",padding:"6px 20px",fontSize:11}}
          onClick={onContinue}>
          CONTINUE →
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  FLOOR BONUS SCREEN
// ═══════════════════════════════════════════════════════
function FloorBonusScreen({msg, floor, onContinue}) {
  return (
    <div style={{
      position:"absolute",inset:0,background:"#000000cc",
      display:"flex",alignItems:"center",justifyContent:"center",
      zIndex:30,...PX,
    }}>
      <div style={{
        background:C.uiBg,border:`2px solid ${C.textGreen}`,
        padding:18,textAlign:"center",minWidth:200,
      }}>
        <div style={{color:C.textGreen,fontSize:13,letterSpacing:3,marginBottom:8}}>DESCENT BONUS</div>
        <div style={{color:C.textBright,fontSize:10,marginBottom:4}}>Floor {floor} reached!</div>
        <div style={{color:C.gold,fontSize:10,marginBottom:14}}>{msg}</div>
        <button style={{...btnStyle(true,C.textGreen),textAlign:"center",padding:"6px 20px",fontSize:11}}
          onClick={onContinue}>
          DESCEND →
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  ITEM SCREEN
// ═══════════════════════════════════════════════════════
function ItemScreen({item, onTake, onLeave}) {
  const it = item && ITEMS[item.type]
  if (!it) return null
  const rc = RARITY_COLOR[it.rarity] || C.silver
  return (
    <div style={{
      position:"absolute",inset:0,background:"#000000aa",
      display:"flex",alignItems:"center",justifyContent:"center",
      zIndex:30,...PX,
    }}>
      <div style={{background:C.uiBg,border:`2px solid ${rc}`,padding:18,textAlign:"center",minWidth:190}}>
        <div style={{color:rc,fontSize:13,letterSpacing:2,marginBottom:6}}>✦ ITEM FOUND ✦</div>
        <div style={{color:C.textBright,fontSize:11,marginBottom:3}}>{it.name}</div>
        <div style={{color:rc,fontSize:8,letterSpacing:1,marginBottom:3}}>[{it.rarity?.toUpperCase()}]</div>
        <div style={{color:C.textDim,fontSize:9,marginBottom:14}}>{it.desc}</div>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <button style={{...btnStyle(true,rc),width:"auto",padding:"6px 14px",textAlign:"center",fontSize:10}} onClick={onTake}>TAKE</button>
          <button style={{...btnStyle(false),width:"auto",padding:"6px 14px",textAlign:"center",fontSize:10}} onClick={onLeave}>LEAVE</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  STATS SCREEN
// ═══════════════════════════════════════════════════════
function StatsScreen({player, floor, onClose}) {
  return (
    <div style={{
      position:"absolute",inset:0,background:"#000000ee",
      display:"flex",alignItems:"center",justifyContent:"center",
      zIndex:40,...PX,
    }}>
      <div style={{background:C.uiBg,border:`2px solid ${C.uiBorder}`,padding:18,minWidth:240}}>
        <div style={{color:C.textGold,fontSize:13,letterSpacing:3,marginBottom:12,textAlign:"center"}}>
          ─ PLAYER STATS ─
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,fontSize:9,marginBottom:12}}>
          {[
            ["LEVEL",      player.level,           C.gold      ],
            ["FLOOR",      floor,                  C.textBright],
            ["BEST FLOOR", player.highestFloor,    C.textGreen ],
            ["ENEMIES",    player.enemiesDefeated, C.textRed   ],
            ["FLOORS CLR", player.floorsCleared,   C.textGreen ],
            ["GOLD",       player.gold,            C.gold      ],
            ["MAX HP",     player.maxHp,           C.hpGreen   ],
            ["MAX MP",     player.maxMp,           C.mpBlue    ],
            ["ATTACK",     player.atk,             C.textRed   ],
            ["DEFENSE",    player.def,             C.silver    ],
            ["MAG.ATK",    player.magAtk,          C.xpPurple  ],
            ["SPELLS",     player.spells.length,   C.mpBlue    ],
          ].map(([k,v,c])=>(
            <div key={k} style={{background:C.uiBox,border:`1px solid ${C.uiBorder}`,padding:"3px 6px"}}>
              <div style={{color:C.textDim,fontSize:7}}>{k}</div>
              <div style={{color:c,fontSize:10}}>{v}</div>
            </div>
          ))}
        </div>
        {player.spells.length > 0 && (
          <div style={{marginBottom:12}}>
            <div style={{color:C.textDim,fontSize:8,marginBottom:4}}>KNOWN SPELLS:</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {player.spells.map(sk=>(
                <span key={sk} style={{
                  background:C.uiBox,border:`1px solid ${SPELLS[sk]?.color||C.uiBorder}`,
                  color:SPELLS[sk]?.color||C.textDim,fontSize:8,padding:"2px 5px",
                }}>
                  {SPELLS[sk]?.name||sk}
                </span>
              ))}
            </div>
          </div>
        )}
        <button style={{...btnStyle(false),textAlign:"center",padding:"6px",fontSize:10}} onClick={onClose}>
          CLOSE
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  D-PAD + STATS BUTTON
// ═══════════════════════════════════════════════════════
function Controls({onDir, onStats}) {
  const Arrow = ({d}) => (
    <div
      onPointerDown={e=>{e.preventDefault();onDir(d)}}
      style={{
        width:36,height:36,background:C.uiBox,
        border:`2px solid ${C.uiBorder}`,display:"flex",
        alignItems:"center",justifyContent:"center",
        cursor:"pointer",userSelect:"none",touchAction:"none",
      }}>
      <svg width="12" height="12" viewBox="0 0 12 12">
        {d==="up"    && <polygon points="6,1 11,10 1,10" fill={C.textDim}/>}
        {d==="down"  && <polygon points="6,11 11,2 1,2"  fill={C.textDim}/>}
        {d==="left"  && <polygon points="1,6 10,1 10,11" fill={C.textDim}/>}
        {d==="right" && <polygon points="11,6 2,1 2,11"  fill={C.textDim}/>}
      </svg>
    </div>
  )
  return (
    <>
      <div style={{position:"absolute",bottom:10,right:10,zIndex:20,
        display:"grid",gridTemplateColumns:"36px 36px 36px",
        gridTemplateRows:"36px 36px 36px",gap:2}}>
        <div/><Arrow d="up"/><div/>
        <Arrow d="left"/>
        <div style={{width:36,height:36,background:C.uiBox,border:`2px solid ${C.uiBorder}`}}/>
        <Arrow d="right"/>
        <div/><Arrow d="down"/><div/>
      </div>
      <button onClick={onStats} style={{
        position:"absolute",bottom:10,left:10,zIndex:20,
        ...btnStyle(false),width:"auto",padding:"5px 10px",fontSize:9,
      }}>STATS</button>
    </>
  )
}

// ═══════════════════════════════════════════════════════
//  GAME OVER
// ═══════════════════════════════════════════════════════
function GameOver({gs, onRestart}) {
  const p = gs.player
  return (
    <div style={{
      position:"absolute",inset:0,background:"#000000f2",
      display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"center",zIndex:50,...PX,gap:6,
    }}>
      <div style={{color:C.hpRed,fontSize:24,letterSpacing:6,marginBottom:6}}>GAME OVER</div>
      <div style={{color:C.textDim,fontSize:10}}>Floor {gs.floor} · Level {p.level}</div>
      <div style={{color:C.gold,fontSize:10}}>Best floor: {p.highestFloor}</div>
      <div style={{color:C.silver,fontSize:10}}>Enemies defeated: {p.enemiesDefeated}</div>
      <div style={{color:C.gold,fontSize:10}}>Total gold: {p.totalGold}</div>
      <div style={{color:C.textDim,fontSize:10}}>Spells known: {p.spells.length}</div>
      <button onClick={onRestart} style={{
        ...btnStyle(false),width:"auto",padding:"8px 28px",fontSize:12,
        marginTop:12,border:`2px solid ${C.hpRed}`,color:C.hpRed,textAlign:"center",
      }}>NEW GAME</button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════
export default function DungeonGame() {
  const svgRef   = useRef(null)
  const gsRef    = useRef(newGame())
  const inputRef = useRef(createInput())
  const rafRef   = useRef(null)

  const [ui, setUi] = useState(() => {
    const gs = gsRef.current
    return {
      screen: gs.screen, floor: gs.floor,
      player: {...gs.player, spells:[...gs.player.spells], inventory:[...gs.player.inventory]},
      message: gs.message, battleLog: gs.battleLog,
      levelUpMsg:"", pickedItem:null, currentEnemy:null,
      floorBonusMsg:null, showStats:false,
    }
  })

  const syncUi = useCallback(()=>{
    const gs = gsRef.current
    setUi({
      screen: gs.screen, floor: gs.floor,
      player: {...gs.player, spells:[...gs.player.spells], inventory:[...gs.player.inventory]},
      message: gs.message, battleLog:[...(gs.battleLog||[])],
      levelUpMsg: gs.levelUpMessage||"",
      pickedItem: gs.pickedItem,
      currentEnemy: gs.currentEnemy ? {...gs.currentEnemy} : null,
      floorBonusMsg: gs.floorBonusMsg||null,
      showStats: false,
    })
  },[])

  const handleDir = useCallback((dir)=>{
    const gs = gsRef.current
    movePlayer(gs, dir)
    syncUi()
  },[syncUi])

  const handleBattleAction = useCallback((action)=>{
    const gs = gsRef.current
    battleAction(gs, action)
    syncUi()
  },[syncUi])

  const handleLevelUpContinue = useCallback(()=>{
    gsRef.current.screen = "explore"
    syncUi()
  },[syncUi])

  const handleFloorBonusContinue = useCallback(()=>{
    gsRef.current.floorBonusMsg = null
    syncUi()
  },[syncUi])

  const handleItemTake = useCallback(()=>{
    const gs = gsRef.current
    const it = gs.pickedItem
    if (it) {
      const def = ITEMS[it.type]
      if (def) {
        const consumables = ["healthPotion","mpPotion","elixir","xpOrb"]
        if (consumables.includes(it.type)) {
          gs.player.inventory.push(it.type)
          gs.message = `${def.name} added to bag`
        } else {
          def.use(gs.player, it.type, gs)
          gs.message = `${def.name}: ${def.desc}`
        }
      }
    }
    gs.pickedItem = null; gs.screen = "explore"
    syncUi()
  },[syncUi])

  const handleItemLeave = useCallback(()=>{
    gsRef.current.pickedItem = null; gsRef.current.screen = "explore"
    syncUi()
  },[syncUi])

  const handleRestart = useCallback(()=>{
    gsRef.current = newGame(); syncUi()
  },[syncUi])

  const [showStats, setShowStats] = useState(false)

  // Keyboard
  useEffect(()=>{
    const inp = inputRef.current
    ;["up","down","left","right"].forEach(d=>{ inp.handlers[d]=()=>handleDir(d) })
    const kd = e=>{
      if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) e.preventDefault()
      inp.onKeyDown(e.key)
    }
    const ku = e=>inp.onKeyUp(e.key)
    window.addEventListener("keydown",kd)
    window.addEventListener("keyup",ku)
    return ()=>{ window.removeEventListener("keydown",kd); window.removeEventListener("keyup",ku) }
  },[handleDir])

  // Game loop
  useEffect(()=>{
    let last = performance.now()
    const loop = now=>{
      const dt = Math.min(now-last,50); last=now
      inputRef.current.tick(dt)
      const gs = gsRef.current
      if (gs.screen==="explore" && svgRef.current) renderExplore(svgRef.current, gs)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return ()=>cancelAnimationFrame(rafRef.current)
  },[])

  const gs = gsRef.current
  const isBossFloor = DifficultyScaling.isBossFloor(ui.floor)

  return (
    <div style={{
      position:"relative",width:"100%",height:"100%",minHeight:400,
      background:C.black,overflow:"hidden",display:"flex",
      flexDirection:"column",alignItems:"center",justifyContent:"center",
    }}>
      {/* HUD */}
      <HUD player={ui.player} floor={ui.floor} message={ui.message}/>

      {/* World SVG */}
      <div style={{
        marginTop:30,width:CW,height:CH,maxWidth:"100%",
        imageRendering:"pixelated",flexShrink:0,overflow:"hidden",
      }}>
        <svg ref={svgRef} width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}
          style={{imageRendering:"pixelated",display:"block",width:"100%",height:"100%"}}
          xmlns="http://www.w3.org/2000/svg"/>
      </div>

      {/* Controls */}
      {ui.screen==="explore" && !showStats && (
        <Controls onDir={handleDir} onStats={()=>setShowStats(true)}/>
      )}

      {/* Overlays — rendered in priority order */}
      {ui.screen==="battle" && ui.currentEnemy && (
        <BattleScreen
          gs={{...gs, player:ui.player, currentEnemy:ui.currentEnemy, battleLog:ui.battleLog}}
          onAction={handleBattleAction}/>
      )}

      {ui.screen==="levelup" && (
        <LevelUpScreen player={ui.player} message={ui.levelUpMsg} onContinue={handleLevelUpContinue}/>
      )}

      {ui.screen==="explore" && ui.floorBonusMsg && (
        <FloorBonusScreen msg={ui.floorBonusMsg} floor={ui.floor} onContinue={handleFloorBonusContinue}/>
      )}

      {ui.screen==="item" && (
        <ItemScreen item={ui.pickedItem} onTake={handleItemTake} onLeave={handleItemLeave}/>
      )}

      {ui.screen==="gameover" && (
        <GameOver gs={{...gs, player:ui.player}} onRestart={handleRestart}/>
      )}

      {showStats && (
        <StatsScreen player={ui.player} floor={ui.floor} onClose={()=>setShowStats(false)}/>
      )}

      {/* Floor depth indicator strip */}
      <div style={{
        position:"absolute",bottom:0,left:0,right:0,height:3,
        background:isBossFloor?C.eBoss:C.uiBorder,
        opacity:0.6,pointerEvents:"none",zIndex:5,
      }}/>

      {/* Controls hint */}
      <div style={{
        position:"absolute",bottom:6,left:0,right:0,textAlign:"center",
        fontSize:7,color:C.textDim,...PX,opacity:0.4,pointerEvents:"none",zIndex:5,
      }}>
        WASD/ARROWS · WALK INTO ENEMY TO BATTLE · FIND STAIRS ▼ TO DESCEND
      </div>
    </div>
  )
}
