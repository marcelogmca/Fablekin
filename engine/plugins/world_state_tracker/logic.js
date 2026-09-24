// plugins/world_state_tracker/logic.js

const fs = require('fs');
const path = require('path');
const { formatIndexedScene, formatIndexedSceneLine } = require('../../modules/vn_manager/scene_prompt_formatter.js');
const START_DAY = 1;
const START_HOUR = 8;

/**
 * Calculates the current time period (Dawn, Day, Dusk, Night) based on the hour.
 * @param {number} hour24 - The current hour in 24h format.
 * @param {Object} settings - Plugin settings.
 * @returns {string} The time period.
 */
function calculateTimePeriod(hour24, settings) {
  const dawn = settings.dawn_start !== undefined ? settings.dawn_start : 5;
  const day = settings.day_start !== undefined ? settings.day_start : 9;
  const dusk = settings.dusk_start !== undefined ? settings.dusk_start : 18;
  const night = settings.night_start !== undefined ? settings.night_start : 21;

  if (hour24 >= night || hour24 < dawn) return 'Night';
  if (hour24 >= dusk) return 'Dusk';
  if (hour24 >= day) return 'Day';
  return 'Dawn';
}

/**
 * Parses a natural language time duration string into total minutes.
 * Supports: minutes, hours, days, weeks, months, years.
 * @param {string} durationStr - The duration string (e.g., "5 years", "2h 15m").
 * @returns {number} Total minutes.
 */
function parseTimeJumpToMinutes(durationStr) {
  if (!durationStr) return 0;
  if (typeof durationStr === 'number') return durationStr;

  const units = {
    year: 525600,
    month: 43200,
    week: 10080,
    day: 1440,
    hour: 60,
    minute: 1,
    y: 525600,
    mo: 43200,
    w: 10080,
    d: 1440,
    h: 60,
    m: 1
  };

  let totalMinutes = 0;
  const regex = /(\d+(?:\.\d+)?)\s*([a-z]+)/gi;
  let match;
  let found = false;

  while ((match = regex.exec(durationStr)) !== null) {
    const value = parseFloat(match[1]);
    const unitPart = match[2].toLowerCase();

    for (const [unit, multiplier] of Object.entries(units)) {
      if (unitPart.startsWith(unit)) {
        totalMinutes += value * multiplier;
        found = true;
        break;
      }
    }
  }

  if (!found) {
    const fallback = parseFloat(durationStr);
    if (!isNaN(fallback)) return fallback;
  }

  return Math.round(totalMinutes);
}

function getProcessedLines(turnContext) {
  return turnContext?.processed?.vnManager?.processedLines || [];
}

function formatScriptLine(line, index, label = 'Line') {
  const formatted = formatIndexedSceneLine(line, index);
  return label === 'Line' ? formatted : `${label} ${formatted}`;
}

function getLineCount(turnContext) {
  return Math.max(1, getProcessedLines(turnContext).length || 1);
}

function clampLineIndex(value, maxLine) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(Math.round(numeric), Math.max(0, maxLine)));
}

function buildNumberedScript(turnContext) {
  const processedLines = getProcessedLines(turnContext);
  return formatIndexedScene(processedLines);
}

function createDefaultStructuredData(settings = {}) {
  return {
    locations: [],
    weatherChange: '',
    climate: '',
    safetyLevel: 'Safe',
    crowdDensity: 'Alone',
    inventory: [],
    formattedDate: `Day ${START_DAY}, 8:00 AM`,
    qualitativeTime: calculateTimePeriod(START_HOUR, settings),
    elapsedTime: '0 minutes'
  };
}

function formatBackgroundChangeHints(turnContext) {
  const bgChanges = Array.isArray(turnContext?.output?.bgChanges) ? turnContext.output.bgChanges : [];
  if (bgChanges.length === 0) {
    return 'No background changes were selected. Treat this as a weak signal that visual setting may remain stable.';
  }
  return bgChanges.map((change) => {
    const line = Number.isInteger(change.line) ? change.line : 0;
    const bgPath = change.path || '';
    return `${line}. ${path.basename(bgPath) || bgPath || 'unknown background'}`;
  }).join('\n');
}

function normalizeInventoryChanges(rawChanges = []) {
  if (!Array.isArray(rawChanges)) return [];
  const normalized = [];
  for (const change of rawChanges) {
    const item = String(change?.item || '').trim();
    const delta = Number(change?.change);
    if (!item || !Number.isFinite(delta) || delta === 0) continue;
    normalized.push({
      item,
      change: Math.round(delta),
      utf8_icon: change?.utf8_icon ? String(change.utf8_icon) : null,
      description: change?.description ? String(change.description) : null,
      context: change?.context ? String(change.context) : null
    });
  }
  return normalized;
}

function normalizeInventoryIntentItems(rawItems = []) {
  if (!Array.isArray(rawItems)) return [];
  const normalized = [];
  const seen = new Set();
  for (const raw of rawItems) {
    const item = String(raw?.item || raw?.name || raw || '').replace(/\s+/g, ' ').trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const quantity = Math.max(1, Math.round(Number(raw?.quantity || 1)));
    normalized.push({ item, quantity });
  }
  return normalized;
}

function applyInventoryDisposalIntentToEvents(events = [], previousState = {}, turnContext = {}) {
  const deleteItems = normalizeInventoryIntentItems(turnContext?.input?.inventoryIntent?.deleteItems || []);
  if (deleteItems.length === 0) return events;

  const inventoryByKey = new Map((previousState?.inventory || [])
    .map(item => [String(item.item || '').toLowerCase(), Number(item.quantity || 0)]));
  const changes = [];
  for (const item of deleteItems) {
    const carriedQuantity = Math.max(0, Math.round(Number(inventoryByKey.get(item.item.toLowerCase()) || 0)));
    if (carriedQuantity <= 0) continue;
    changes.push({
      item: item.item,
      change: -carriedQuantity,
      context: 'manual_inventory_delete'
    });
  }
  if (changes.length === 0) return events;

  const normalizedEvents = Array.isArray(events) && events.length > 0
    ? events
    : [createBaselineWorldStateEvent(previousState)];
  const firstEvent = normalizedEvents[0];
  firstEvent.inventory_changes = [
    ...normalizeInventoryChanges(firstEvent.inventory_changes || []),
    ...changes
  ];
  firstEvent.reasoning = [
    firstEvent.reasoning,
    `Applied user-confirmed inventory disposal intent for: ${changes.map(change => change.item).join(', ')}.`
  ].filter(Boolean).join(' | ');
  return normalizedEvents;
}

function normalizeMemoryRecallCandidates(rawCandidates = [], options = {}) {
  if (!Array.isArray(rawCandidates)) return [];

  const maxCandidates = Math.max(0, Math.min(Number(options.limit ?? 2) || 0, 4));
  const memories = [];
  const seen = new Set();

  for (const raw of rawCandidates) {
    if (!raw || typeof raw !== 'object') continue;

    const subject = String(raw.subject || raw.entity || raw.source || options.defaultSubject || 'world').replace(/\s+/g, ' ').trim();
    const memory = String(raw.memory || raw.text || raw.statement || '').replace(/\s+/g, ' ').trim();
    const evidence = String(raw.evidence || raw.scene_basis || raw.context || '').replace(/\s+/g, ' ').trim();
    const whyItMatters = String(raw.why_it_matters || raw.future_use || raw.importance || '').replace(/\s+/g, ' ').trim();
    const notAlreadyTracked = String(raw.not_already_tracked || raw.not_tracked_by || raw.distinct_from_tracker || '').replace(/\s+/g, ' ').trim();
    const line = Number(raw.line ?? raw.evidence_line);
    const hasSceneBasis = Number.isInteger(line) || evidence.length > 0;

    if (!subject || !memory || !hasSceneBasis || !whyItMatters || !notAlreadyTracked) continue;

    const key = `${subject.toLowerCase()}|${memory.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    memories.push({
      subject,
      kind: String(raw.kind || 'world_memory').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 64) || 'world_memory',
      memory,
      evidence: [
        Number.isInteger(line) ? `Line ${line}` : '',
        evidence,
        `Why it matters later: ${whyItMatters}`,
        `Not already tracked because: ${notAlreadyTracked}`
      ].filter(Boolean).join(' | '),
      cues: Array.isArray(raw.cues) ? raw.cues : [],
      durability: raw.durability || 'situational',
      salience: Number.isFinite(Number(raw.salience)) ? Number(raw.salience) : 5
    });

    if (memories.length >= maxCandidates) break;
  }

  return memories;
}

async function storeWorldMemoryRecalls(turnContext, tools, extractedData) {
  const candidates = normalizeMemoryRecallCandidates(extractedData?._memory_recall, {
    defaultSubject: 'world',
    limit: 2
  });

  if (candidates.length === 0) return;

  try {
    const stored = await tools.plugins.tryCall(
      'memory_recall',
      'storeMemories',
      [candidates, { sourcePlugin: 'world_state_tracker', domain: 'world', subject: 'world' }],
      { fallback: null, silent: true }
    );
    if (stored !== null && stored !== undefined) {
      tools.logger.runtime(`Stored ${candidates.length} world memory recall candidate(s).`);
    }
  } catch (error) {
    tools.logger.warn('Extraction', `Failed to store world memory recall candidates: ${error.message}`);
  }
}

function createBaselineWorldStateEvent(previousState = {}) {
  return {
    line: 0,
    time_passed_minutes: 0,
    weather: previousState?.weather || null,
    climate: previousState?.climate || null,
    safety_level: previousState?.safety_level || null,
    crowd_density: previousState?.crowd_density || null,
    inventory_changes: [],
    reasoning: previousState ? 'Carry-forward baseline from previous state.' : 'Default baseline event.'
  };
}

function normalizeWorldStateEvents(rawResult, previousState, turnContext) {
  const lineCount = getLineCount(turnContext);
  const maxLine = lineCount - 1;
  const rawEvents = Array.isArray(rawResult?.world_state_events) ? rawResult.world_state_events : [];

  const normalized = rawEvents
    .filter((event) => event && typeof event === 'object')
    .map((event) => {
      const line = clampLineIndex(event.line ?? event.index ?? event.start_line, maxLine);
      const timePassed = parseTimeJumpToMinutes(event.time_passed_minutes ?? event.time_jump_total ?? 0);
      return {
        line,
        time_passed_minutes: Math.max(0, Math.round(timePassed)),
        weather: event.weather ? String(event.weather) : null,
        climate: event.climate ? String(event.climate) : null,
        safety_level: event.safety_level ? String(event.safety_level) : null,
        crowd_density: event.crowd_density ? String(event.crowd_density) : null,
        inventory_changes: normalizeInventoryChanges(event.inventory_changes || []),
        reasoning: event.reasoning ? String(event.reasoning) : ''
      };
    })
    .sort((left, right) => left.line - right.line);

  const merged = [];
  for (const event of normalized) {
    const last = merged[merged.length - 1];
    if (!last || last.line !== event.line) {
      merged.push(event);
      continue;
    }

    last.time_passed_minutes += event.time_passed_minutes;
    if (event.weather) last.weather = event.weather;
    if (event.climate) last.climate = event.climate;
    if (event.safety_level) last.safety_level = event.safety_level;
    if (event.crowd_density) last.crowd_density = event.crowd_density;
    if (event.inventory_changes.length > 0) {
      last.inventory_changes = last.inventory_changes.concat(event.inventory_changes);
    }
    if (event.reasoning) {
      last.reasoning = [last.reasoning, event.reasoning].filter(Boolean).join(' | ');
    }
  }

  if (!merged.some((event) => event.line === 0)) {
    merged.unshift(createBaselineWorldStateEvent(previousState));
  }

  return merged;
}

function formatElapsedFromMinutes(totalMinutes = 0) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function buildWorldStateUpdateBrief(timeline = [], previousState = {}) {
  const events = (Array.isArray(timeline) ? timeline : [])
    .filter((event) => event && typeof event === 'object')
    .sort((left, right) => clampLineIndex(left.line, 999999) - clampLineIndex(right.line, 999999));
  if (events.length === 0) return '';

  const actions = [];
  const reasons = [];
  const stateFields = [
    ['weather', 'weatherChange', 'weather'],
    ['climate', 'climate', 'climate'],
    ['safety_level', 'safetyLevel', 'safety level'],
    ['crowd_density', 'crowdDensity', 'crowd density']
  ];
  const runningState = Object.fromEntries(stateFields.map(([eventKey, previousKey]) => [eventKey, previousState?.[previousKey] || null]));
  const inventoryDeltas = new Map();
  let elapsedMinutes = 0;

  for (const event of events) {
    elapsedMinutes += Math.max(0, Math.round(Number(event.time_passed_minutes) || 0));
    for (const [eventKey, , label] of stateFields) {
      const nextValue = String(event[eventKey] || '').trim();
      if (!nextValue || nextValue.toLowerCase() === String(runningState[eventKey] || '').toLowerCase()) continue;
      const previousValue = String(runningState[eventKey] || '').trim();
      actions.push(previousValue
        ? `Changed ${label} from ${previousValue} to ${nextValue}.`
        : `Established ${label} as ${nextValue}.`);
      runningState[eventKey] = nextValue;
    }

    for (const change of normalizeInventoryChanges(event.inventory_changes)) {
      const key = change.item.toLowerCase();
      const current = inventoryDeltas.get(key) || { item: change.item, change: 0 };
      current.change += change.change;
      inventoryDeltas.set(key, current);
    }

    const reasoning = String(event.reasoning || '').replace(/\s+/g, ' ').trim();
    if (reasoning && !/^(carry-forward baseline|default baseline event)/i.test(reasoning) && !reasons.includes(reasoning)) {
      reasons.push(reasoning.slice(0, 500));
    }
  }

  if (elapsedMinutes > 0) actions.unshift(`Advanced the party clock by ${formatElapsedFromMinutes(elapsedMinutes)}.`);

  const inventoryChanges = [...inventoryDeltas.values()].filter((change) => change.change !== 0);
  if (inventoryChanges.length > 0) {
    actions.push(`Applied inventory changes: ${inventoryChanges
      .map((change) => `${change.change > 0 ? '+' : ''}${change.change} ${change.item}`)
      .join(', ')}.`);
  }

  if (actions.length === 0) {
    actions.push('Carried forward the prior world state; no tracked environmental, temporal, or inventory change was established.');
  }
  if (reasons.length > 0) actions.push(`Reasoning: ${reasons.slice(0, 3).join(' ')}`);
  return actions.map((line) => `- ${line}`).join('\n');
}

async function buildPreviousTurnUpdate(turnContext, tools, turnNumber) {
  const timeline = await getWorldStateTimelineForTurn(turnContext, tools, turnNumber);
  if (timeline.length === 0) return '';

  let previousState = {};
  if (turnNumber > 1) {
    const previousSnapshot = await synthesizeWorldState(turnContext, tools, turnNumber - 1);
    previousState = previousSnapshot?.structuredData || {};
  }
  return buildWorldStateUpdateBrief(timeline, previousState);
}

function parseFormattedDateToAbsoluteMinutes(formattedDate) {
  const text = String(formattedDate || '');
  const match = text.match(/Day\s+(\d+),\s+(\d+):(\d+)\s+(AM|PM)/i);
  if (!match) {
    return (START_HOUR * 60);
  }

  const day = Math.max(START_DAY, parseInt(match[1], 10) || START_DAY);
  let hour = Math.max(1, Math.min(12, parseInt(match[2], 10) || 12));
  const minute = Math.max(0, Math.min(59, parseInt(match[3], 10) || 0));
  const ampm = String(match[4] || 'AM').toUpperCase();

  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  return ((day - START_DAY) * 1440) + (hour * 60) + minute;
}

function formatAbsoluteMinutesToDate(absoluteMinutes) {
  const safeMinutes = Math.max(0, Math.round(Number(absoluteMinutes) || 0));
  const currentDay = Math.floor(safeMinutes / 1440) + START_DAY;
  const currentHour24 = Math.floor((safeMinutes % 1440) / 60);
  const currentMinute = safeMinutes % 60;
  const ampm = currentHour24 >= 12 ? 'PM' : 'AM';
  const displayHour = currentHour24 % 12 || 12;
  const displayMinute = currentMinute.toString().padStart(2, '0');
  return {
    formattedDate: `Day ${currentDay}, ${displayHour}:${displayMinute} ${ampm}`,
    hour24: currentHour24
  };
}

function cloneStructuredData(structuredData = {}) {
  return JSON.parse(JSON.stringify(structuredData || {}));
}

async function getWorldStateTimelineForTurn(turnContext, tools, turnNumber) {
  if (Number(turnContext?.turnNumber) === Number(turnNumber) && Array.isArray(turnContext?.output?.worldStateTimeline)) {
    return turnContext.output.worldStateTimeline;
  }

  try {
    const rows = await tools.db.chat.query(
      `SELECT fact_value FROM facts
       WHERE project_name = ? AND predicate = 'world_state_timeline' AND turn_number = ?
       ORDER BY id DESC LIMIT 1`,
      [String(turnContext?.projectName || '').toLowerCase(), Number(turnNumber || 0)]
    );
    if (!rows || rows.length === 0) return [];
    const parsed = JSON.parse(rows[0].fact_value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function applyTimelineEventsToStructuredData(baseData, timeline, dialogueIndex, settings) {
  const structuredData = cloneStructuredData(baseData);
  const normalizedIndex = Number.isFinite(Number(dialogueIndex)) ? Math.max(0, Math.round(Number(dialogueIndex))) : null;
  const events = (Array.isArray(timeline) ? timeline : [])
    .filter((event) => event && typeof event === 'object')
    .sort((left, right) => clampLineIndex(left.line, 999999) - clampLineIndex(right.line, 999999))
    .filter((event) => normalizedIndex === null || clampLineIndex(event.line, 999999) <= normalizedIndex);

  let elapsedMinutes = 0;
  const inventoryMap = new Map((structuredData.inventory || []).map((item) => [String(item.item || '').toLowerCase(), { ...item }]));

  for (const event of events) {
    const timeDelta = Math.max(0, Math.round(Number(event.time_passed_minutes) || 0));
    elapsedMinutes += timeDelta;
    if (event.weather) structuredData.weatherChange = event.weather;
    if (event.climate) structuredData.climate = event.climate;
    if (event.safety_level) structuredData.safetyLevel = event.safety_level;
    if (event.crowd_density) structuredData.crowdDensity = event.crowd_density;

    const invChanges = normalizeInventoryChanges(event.inventory_changes);
    for (const invChange of invChanges) {
      const key = String(invChange.item || '').toLowerCase();
      if (!key) continue;
      const existing = inventoryMap.get(key) || {
        item: invChange.item,
        quantity: 0,
        icon: invChange.utf8_icon || '📦',
        description: invChange.description || '',
        origin: invChange.context || ''
      };
      existing.quantity = Math.max(0, Number(existing.quantity || 0) + Number(invChange.change || 0));
      if (invChange.utf8_icon) existing.icon = invChange.utf8_icon;
      if (invChange.description) existing.description = invChange.description;
      if (invChange.context && Number(invChange.change || 0) > 0) existing.origin = invChange.context;
      inventoryMap.set(key, existing);
    }
  }

  const baselineAbsoluteMinutes = parseFormattedDateToAbsoluteMinutes(structuredData.formattedDate);
  const absolute = baselineAbsoluteMinutes + elapsedMinutes;
  const dateInfo = formatAbsoluteMinutesToDate(absolute);
  structuredData.formattedDate = dateInfo.formattedDate;
  structuredData.qualitativeTime = calculateTimePeriod(dateInfo.hour24, settings || {});
  structuredData.elapsedTime = formatElapsedFromMinutes(elapsedMinutes);

  structuredData.inventory = [...inventoryMap.values()]
    .filter((item) => Number(item.quantity || 0) > 0)
    .map((item) => ({
      item: item.item,
      quantity: item.quantity,
      icon: item.icon || '📦',
      description: item.description || '',
      origin: item.origin || ''
    }))
    .sort((left, right) => String(left.item || '').localeCompare(String(right.item || '')));

  return structuredData;
}

function buildTimeTitleContributions(timeline = [], previousState = {}, settings = {}, thresholdMinutes = 60) {
  const contributions = [];
  let absoluteMinutes = parseFormattedDateToAbsoluteMinutes(previousState?.formattedDate);
  const threshold = Math.max(1, Math.round(Number(thresholdMinutes) || 60));
  const events = (Array.isArray(timeline) ? timeline : [])
    .filter(event => event && Number.isFinite(Number(event.line)))
    .slice()
    .sort((left, right) => Number(left.line) - Number(right.line));

  for (const event of events) {
    const delta = Math.max(0, Math.round(Number(event.time_passed_minutes) || 0));
    if (delta <= 0) continue;

    const previousInfo = formatAbsoluteMinutesToDate(absoluteMinutes);
    const previousPhase = calculateTimePeriod(previousInfo.hour24, settings);
    const previousDay = Math.floor(absoluteMinutes / 1440);
    absoluteMinutes += delta;
    const nextInfo = formatAbsoluteMinutesToDate(absoluteMinutes);
    const nextPhase = calculateTimePeriod(nextInfo.hour24, settings);
    const nextDay = Math.floor(absoluteMinutes / 1440);

    if (delta >= threshold || previousDay !== nextDay || previousPhase !== nextPhase) {
      contributions.push({
        line: Math.max(0, Math.round(Number(event.line))),
        kind: 'time',
        text: nextInfo.formattedDate
      });
    }
  }

  return contributions;
}

async function buildPreviousChapterGrounding(turnContext, tools, options = {}) {
  const currentTurn = Number(turnContext?.turnNumber || 0);
  if (currentTurn <= 1 || typeof turnContext?.getPreviousChapter !== 'function') {
    return 'No previous chapter exists. Treat the current script as the start of tracked play.';
  }

  let previousChapter = null;
  try {
    previousChapter = await turnContext.getPreviousChapter();
  } catch (error) {
    tools.logger?.warn?.('Extraction', `Failed to load previous chapter grounding: ${error.message}`);
  }

  if (!previousChapter) {
    return 'Previous chapter could not be loaded. Use only CURRENT_DATE and PREVIOUS_STATE for grounding.';
  }

  const previousTurn = Number(previousChapter.turnNumber || (currentTurn - 1));
  const settings = tools.settings.getSelf();
  const skipLocation = options.skipLocation || false;
  const previousLines = getProcessedLines(previousChapter);
  let baselineStructuredData = null;
  let finalStructuredData = null;
  let timeline = [];

  if (previousTurn <= 1) {
    baselineStructuredData = createDefaultStructuredData(settings);
  } else {
    const baseline = await synthesizeWorldState(previousChapter, tools, previousTurn - 1, { skipLocation });
    baselineStructuredData = baseline?.structuredData || createDefaultStructuredData(settings);
  }

  try {
    timeline = await getWorldStateTimelineForTurn(previousChapter, tools, previousTurn);
  } catch {
    timeline = [];
  }

  try {
    const finalSnapshot = await synthesizeWorldState(previousChapter, tools, previousTurn, { skipLocation });
    finalStructuredData = finalSnapshot?.structuredData || null;
  } catch {
    finalStructuredData = null;
  }

  let updateBrief = '';
  try {
    updateBrief = await buildPreviousTurnUpdate(previousChapter, tools, previousTurn);
  } catch {
    updateBrief = '';
  }

  const lines = [];
  lines.push('### PREVIOUS CHAPTER GROUNDING (ALREADY TRACKED - DO NOT RE-EXTRACT)');
  lines.push(`Previous chapter: Turn ${previousTurn}. This chapter has already been evaluated by World State Tracker.`);
  if (finalStructuredData?.formattedDate) {
    lines.push(`Final tracked time after previous chapter: ${finalStructuredData.qualitativeTime || 'Unknown'} (${finalStructuredData.formattedDate}).`);
  }
  lines.push('Use this section only to understand references in the CURRENT SCRIPT, such as "last night", "the night before", "still tired", "already awake", or "yesterday".');
  lines.push('Never add time for sleep, travel, waiting, weather, inventory, or location changes shown only in this previous chapter. Those changes are already reflected in CURRENT_DATE and PREVIOUS_STATE.');
  if (updateBrief) {
    lines.push('');
    lines.push('Already-tracked previous chapter update:');
    lines.push(updateBrief);
  }

  if (previousLines.length === 0) {
    const fallbackText = previousChapter?.output?.fulltext || previousChapter?.output?.fullText || previousChapter?.output?.text || previousChapter?.processed?.narrativeEngine?.writerResponse || '';
    if (fallbackText) {
      lines.push('');
      lines.push('Previous chapter text (already tracked):');
      lines.push(fallbackText);
    }
    return lines.join('\n');
  }

  lines.push('');
  lines.push('Previous chapter indexed scene with tracked time after each line:');
  for (const [index, line] of previousLines.entries()) {
    let stateAtLine = null;
    if (Array.isArray(timeline) && timeline.length > 0) {
      stateAtLine = applyTimelineEventsToStructuredData(baselineStructuredData, timeline, index, settings);
    } else if (finalStructuredData) {
      stateAtLine = finalStructuredData;
    }
    const trackedTime = stateAtLine?.formattedDate
      ? ` [already tracked time after this line: ${stateAtLine.qualitativeTime || 'Unknown'} (${stateAtLine.formattedDate})]`
      : '';
    lines.push(`${formatScriptLine(line, index, 'Previous Line')}${trackedTime}`);
  }

  return lines.join('\n');
}

function buildSynthesisTextFromStructuredData(worldStateData) {
  const parts = [];
  const cleanParts = [];

  parts.push(`It is currently ${worldStateData.qualitativeTime} (${worldStateData.formattedDate}). Consider the time of day when writing, you should be aware of stuff such as day light vs night time, lunch/dinner time, time to go to sleep, etc.\n*Every* character must be aware of the current time and make their decisions accordingly.\n If your scene advances time in a major way, make it explicit in the narrative text.`);
  cleanParts.push(`It is currently ${worldStateData.formattedDate}.`);

  parts.push(`Total elapsed time since the start of the adventure: ${worldStateData.elapsedTime}.`);
  cleanParts.push(`Total elapsed time since the start of the adventure: ${worldStateData.elapsedTime}.`);

  if (worldStateData.weatherChange) {
    parts.push(`The weather is ${worldStateData.weatherChange}.`);
    cleanParts.push(`The weather is ${worldStateData.weatherChange}.`);
  }

  if (worldStateData.climate) {
    parts.push(`The climate is ${worldStateData.climate}.`);
    cleanParts.push(`The climate is ${worldStateData.climate}.`);
  }

  parts.push(`Safety Level: ${worldStateData.safetyLevel}. Crowd Density: ${worldStateData.crowdDensity}.`);
  cleanParts.push(`Safety Level: ${worldStateData.safetyLevel}. Crowd Density: ${worldStateData.crowdDensity}.`);

  if (Array.isArray(worldStateData.locations) && worldStateData.locations.length > 0) {
    parts.push(`Current location: ${worldStateData.locations.join(', ')}.`);
    cleanParts.push(`Current location: ${worldStateData.locations.join(', ')}.`);
  }

  if (Array.isArray(worldStateData.inventory) && worldStateData.inventory.length > 0) {
    const invStrings = worldStateData.inventory.map(inv => {
      let s = `${inv.item}: ${inv.quantity}`;
      if (inv.description) s += ` (${inv.description})`;
      if (inv.origin) s += ` [Origin: ${inv.origin}]`;
      return s + '\n';
    });
    parts.push(`Party Inventory: \n-${invStrings.join('-')}`);
    cleanParts.push(`Party Inventory: \n-${invStrings.join('-')}`);
  }

  return {
    synthesizedText: parts.join('\n'),
    cleanSynthesizedText: cleanParts.join('\n')
  };
}

/**
 * Analyzes scene text to extract and store world state facts (Time, Location, Weather).
 * @param {TurnContext} turnContext - The TurnContext object for the current turn.
 * @param {Object} tools - Plugin tools.
 * @param {Object} options - Options for extraction (e.g., skipLocation).
 */
async function extractAndStoreWorldState(turnContext, tools, options = {}) {
  let sceneText = turnContext.processed.narrativeEngine.writerResponse;
  const turnNumber = turnContext.turnNumber;
  const projectName = turnContext.projectName;
  const skipLocation = options.skipLocation || false;

  // Ensure no leftover world state data from a failed/retried turn
  await tools.facts.cleanUpFactsDb();

  // For Turn 1, we include the canon lore/character sheets to establish the initial world state (starting inventory, etc)
  if (turnNumber === 1) {
    const pc = turnContext.promptComponents;
    const canonText = (pc?.root?.canon || []).join('\n\n');
    const introText = String(turnContext.processed?.turnOneIntroText || '').trim();
    const referenceSections = [];
    if (introText) {
      referenceSections.push(`### TURN 1 INTRO / PROLOGUE (REFERENCE BASELINE)\n${introText}`);
    }
    if (canonText) {
      referenceSections.push(`### INITIAL CANON SETUP & STARTING INVENTORY (REFERENCE)\n${canonText}`);
    }
    if (referenceSections.length > 0) {
      sceneText = `${referenceSections.join('\n\n')}\n\n### FIRST SCENE NARRATIVE\n${sceneText}`;
      tools.logger.log(
        'Extraction',
        `Turn 1 detected: Including ${introText ? 'Intro and ' : ''}${canonText ? 'Canon ' : ''}data for initial state extraction.`
      );
    }
  }

  tools.logger.log('Extraction', `extractAndStoreWorldState called for turnNumber: ${turnNumber}, project: ${projectName}, skipLocation: ${skipLocation}`);

  // --- PART 1: Get Previous Turn's World State Snapshot ---
  let prevState = null;

  if (turnNumber === 1) {
    tools.logger.log('Extraction', 'Turn 1 detected: Initializing default World State.');
    prevState = {
      location: null,
      weather: null,
      formattedDate: "Story Start (Day 1, 08:00 AM)",
      cleanText: ""
    };
  } else {
    // Try to get previous world state from turnContext
    let prevStructuredData = turnContext.processed.previousWorldState?.structuredData;
    let prevCleanText = turnContext.processed.previousWorldState?.cleanSynthesizedText;

    // Fallback: If not in context, synthesize it from DB
    if (!prevStructuredData) {
      tools.logger.log('Extraction', 'Previous world state not in context, synthesizing from DB.');
      const synth = await synthesizeWorldState(turnContext, tools, turnNumber - 1);
      prevStructuredData = synth.structuredData;
      prevCleanText = synth.cleanSynthesizedText;
    }

    let prevPartyLocation = null;
    if (prevStructuredData?.locations && prevStructuredData.locations.length > 0) {
      const partyLocationString = prevStructuredData.locations.find(loc => loc.toLowerCase().startsWith('party is at'));
      if (partyLocationString) {
        prevPartyLocation = partyLocationString.substring(partyLocationString.toLowerCase().indexOf(' is at ') + 7);
      } else {
        prevPartyLocation = prevStructuredData.locations[0].substring(prevStructuredData.locations[0].toLowerCase().indexOf(' is at ') + 7);
      }
    }
    prevState = {
      location: prevPartyLocation,
      weather: prevStructuredData?.weatherChange,
      climate: prevStructuredData?.climate,
      safety_level: prevStructuredData?.safetyLevel,
      crowd_density: prevStructuredData?.crowdDensity,
      formattedDate: prevStructuredData?.formattedDate,
      cleanText: prevCleanText,
      inventory: (prevStructuredData?.inventory || []).map(i => ({ item: i.item, quantity: i.quantity }))
    };
  }

  // --- LOCATION TAGS INJECTION ---
  let locationTags = "None";
  if (skipLocation) {
    try {
      const currentLoc = await tools.plugins.tryCall(
        'world_location_tracker',
        'getCurrentLocation',
        [],
        { silent: true, fallback: null }
      );
      if (currentLoc) {
        let tags = [];
        if (currentLoc.tags) tags.push(currentLoc.tags);
        if (Array.isArray(currentLoc.area_tags)) tags.push(...currentLoc.area_tags);
        if (tags.length > 0) {
          locationTags = tags.join(' | ');
        }
      }
    } catch (err) {
      tools.logger.warn('Extraction', `Failed to inject location tags: ${err.message}`);
    }
  }

  // --- NEW: MOVEMENT CONTEXT INJECTION ---
  let travelContextRules = "";
  if (skipLocation && turnNumber > 1) {
    try {
      const prevChapter = await turnContext.getPreviousChapter();
      const prevLoc = prevChapter
        ? await tools.plugins.tryCall(
          'world_location_tracker',
          'getCurrentLocation',
          [{ context: prevChapter }],
          { silent: true, fallback: null }
        )
        : null;
      const currentLoc = await tools.plugins.tryCall(
        'world_location_tracker',
        'getCurrentLocation',
        [],
        { silent: true, fallback: null }
      );

      if (prevLoc && currentLoc && (prevLoc.x !== currentLoc.x || prevLoc.y !== currentLoc.y)) {
        const stats = await tools.plugins.tryCall(
          'world_location_tracker',
          'calculateTravel',
          [prevLoc, currentLoc],
          { silent: true, fallback: null }
        );
        if (stats && stats.distanceKm > 0) {
          travelContextRules = `### MOVEMENT CONTEXT (PHYSICAL TRUTH)
The party has traveled from "${prevLoc.name}" to "${currentLoc.name}".
Distance: ${stats.distanceKm} km.
Estimated Travel Time: ${stats.narrativeText} (${stats.days} days).

**MANDATORY**: You MUST account for this journey in your time calculation. If the travel time is "Several days", the 'time_passed_minutes' must reflect that (e.g., 2 days ≈ 2880 minutes).
`;
          tools.logger.log('Extraction', `Travel Context Injected: ${prevLoc.name} -> ${currentLoc.name} (${stats.distanceKm}km)`);
        }
      }
    } catch (err) {
      tools.logger.warn('Extraction', `Failed to inject movement context: ${err.message}`);
    }
  }

  tools.logger.log('Extraction', 'Previous state for comparison:', null, prevState);

  // --- PART 2: Assemble and Execute the Prompt ---
  const promptPath = path.join(__dirname, 'prompts/world_state_vector_extractor_prompt.txt');
  let promptTemplate = fs.readFileSync(promptPath, 'utf-8');

  const locationRules = skipLocation ? "" : `4. **Location Tracking**:
   - Identify if the party has moved to a new specific location.
   - Use the name of the most prominent building, area, or room.`;

  const locationJsonField = skipLocation ? "" : `"location": "Name of the current specific location",`;
  const numberedScript = buildNumberedScript(turnContext);
  const backgroundChanges = formatBackgroundChangeHints(turnContext);
  const directorPluginFeedback = await tools.director.getFeedback();
  const previousChapterGrounding = await buildPreviousChapterGrounding(turnContext, tools, { skipLocation });

  const prompt = promptTemplate
    .replace('${currentWorldDate}', prevState.formattedDate)
    .replace('${locationRules}', locationRules)
    .replace('${locationJsonField}', locationJsonField)
    .replace('${travelContextRules}', travelContextRules)
    .replace('${locationTags}', locationTags)
    .replace('${numberedScript}', numberedScript || sceneText)
    .replace('${previousChapterGrounding}', previousChapterGrounding)
    .replace('${backgroundChanges}', backgroundChanges)
    .replace('${directorPluginFeedback}', directorPluginFeedback || 'No previous-turn Director feedback is available for this plugin.')
    .replace('${project_directives}', tools.directives.getFormatted('world_logic', { header: '### TRACKING DIRECTIVES' }))
    .replace('${JSON.stringify(previousWorldState)}', JSON.stringify({
      location: prevState.location,
      weather: prevState.weather,
      climate: prevState.climate,
      safety_level: prevState.safety_level,
      crowd_density: prevState.crowd_density,
      last_summary: prevState.cleanText,
      inventory: prevState.inventory
    }))
    .replace('${sceneText}', sceneText);

  try {
    const messages = [{ role: 'user', content: prompt }];

    const selfSettings = tools.settings.getSelf();
    const modelDef = selfSettings.model_def || { model: 'mediumendmodel' };

    let extractedData = null;
    let llmResponse = null;
    const maxRetries = turnNumber === 1 ? 3 : 1;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      tools.logger.log('Extraction', `Calling LLM for world state extraction (Attempt ${attempt}/${maxRetries})...`, 'start');
      llmResponse = await tools.llm.withSchema({
        msg: 'World State Extraction',
        messages,
        model: modelDef.model || 'mediumendmodel',
        provider: modelDef.provider,
        params: {
          callingModule: 'Plugin:world_state_tracker',
        }
      }, (data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
        const hasTimeline = Array.isArray(data.world_state_events);
        if (hasTimeline) return true;
        const hasTime = data.time_jump_total !== undefined || data.time_passed_minutes !== undefined;
        const hasWeather = !!data.weather;
        const hasClimate = !!data.climate;
        const hasSafety = !!data.safety_level;
        const hasCrowd = !!data.crowd_density;
        const hasLocation = skipLocation || !!data.location;
        return hasTime && hasWeather && hasClimate && hasSafety && hasCrowd && hasLocation;
      });
      tools.logger.log('Extraction', 'LLM response received for world state extraction.', 'end');

      extractedData = llmResponse.content;

      if (turnNumber === 1 && attempt < maxRetries) {
        const isMissing = !extractedData || typeof extractedData !== 'object' || Array.isArray(extractedData) ||
          (
            !Array.isArray(extractedData.world_state_events) &&
            (
              (!skipLocation && !extractedData.location) ||
              (!extractedData.weather) ||
              (!extractedData.climate) ||
              (!extractedData.safety_level) ||
              (!extractedData.crowd_density)
            )
          );

        if (isMissing) {
          tools.logger.log('Extraction', `Turn 1: Extracted data is incomplete or invalid. Retrying (${attempt}/${maxRetries})...`);
          continue;
        }
      }
      break;
    }

    if (typeof extractedData !== 'object' || extractedData === null || Array.isArray(extractedData)) {
      tools.logger.error('Extraction', 'LLM response was not a valid JSON object.', null, { response: extractedData });
      return false;
    }

    const newState = extractedData;
    tools.logger.log('Extraction', 'New state extracted:', null, newState);
    const normalizedEvents = applyInventoryDisposalIntentToEvents(
      normalizeWorldStateEvents(newState, prevState, turnContext),
      prevState,
      turnContext
    );
    await storeWorldMemoryRecalls(turnContext, tools, newState);

    if (tools.plugins?.isInstalled?.('vn_cinematographer')) {
      const contributions = buildTimeTitleContributions(normalizedEvents, prevState, selfSettings, 60);
      await tools.plugins.tryCall(
        'vn_cinematographer',
        'replaceTitleContributions',
        [{ source: 'world_state_tracker', contributions }],
        { fallback: [], silent: true }
      );
    }

    const temporalAudit = newState.temporal_audit && typeof newState.temporal_audit === 'object' && !Array.isArray(newState.temporal_audit)
      ? newState.temporal_audit
      : null;
    if (temporalAudit) {
      turnContext.output.worldStateTemporalAudit = temporalAudit;
      turnContext.processed.worldStateTemporalAudit = temporalAudit;
      await tools.facts.appendToFactsDb({
        source: 'world',
        target: 'state',
        predicate: 'world_state_temporal_audit',
        fact_value: JSON.stringify(temporalAudit),
        context: 'temporal_audit_sidecar'
      }, { turn_number: turnNumber });
    }

    turnContext.output.worldStateTimeline = normalizedEvents;
    await tools.facts.appendToFactsDb({
      source: 'world',
      target: 'state',
      predicate: 'world_state_timeline',
      fact_value: JSON.stringify(normalizedEvents),
      context: 'indexed_world_state_events'
    }, { turn_number: turnNumber });

    for (const event of normalizedEvents) {
      await tools.facts.appendToFactsDb({
        source: 'world',
        target: 'state',
        predicate: `world_state_event:${event.line}`,
        fact_value: JSON.stringify(event),
        context: 'indexed_world_state_event'
      }, { turn_number: turnNumber });
    }

    // --- PART 3: Derived query facts from normalized indexed events ---
    const factsToSave = [];
    let runningWeather = prevState.weather || null;
    let runningClimate = prevState.climate || null;
    let runningSafety = prevState.safety_level || null;
    let runningCrowd = prevState.crowd_density || null;
    let totalMinutesPassed = 0;

    for (const event of normalizedEvents) {
      const eventMinutes = Math.max(0, Math.round(Number(event.time_passed_minutes) || 0));
      totalMinutesPassed += eventMinutes;

      if (event.weather && event.weather.toLowerCase() !== String(runningWeather || '').toLowerCase()) {
        factsToSave.push({
          predicate: 'weather_change',
          target: 'World',
          fact_value: event.weather
        });
        runningWeather = event.weather;
      }

      if (event.climate && event.climate.toLowerCase() !== String(runningClimate || '').toLowerCase()) {
        factsToSave.push({
          predicate: 'climate_change',
          target: 'World',
          fact_value: event.climate
        });
        runningClimate = event.climate;
      }

      if (event.safety_level && event.safety_level.toLowerCase() !== String(runningSafety || '').toLowerCase()) {
        factsToSave.push({
          predicate: 'safety_level_change',
          target: 'World',
          fact_value: event.safety_level
        });
        runningSafety = event.safety_level;
      }

      if (event.crowd_density && event.crowd_density.toLowerCase() !== String(runningCrowd || '').toLowerCase()) {
        factsToSave.push({
          predicate: 'crowd_density_change',
          target: 'World',
          fact_value: event.crowd_density
        });
        runningCrowd = event.crowd_density;
      }

      for (const inv of normalizeInventoryChanges(event.inventory_changes)) {
        factsToSave.push({
          predicate: 'inventory',
          target: inv.item,
          fact_value: inv.change,
          context: inv.context || null
        });

        if (inv.utf8_icon) {
          factsToSave.push({
            predicate: 'inventory_icon',
            target: inv.item,
            fact_value: inv.utf8_icon
          });
        }

        if (inv.description) {
          factsToSave.push({
            predicate: 'inventory_description',
            target: inv.item,
            fact_value: inv.description
          });
        }
      }
    }

    if (totalMinutesPassed > 0) {
      factsToSave.unshift({
        predicate: 'quantitative_time_change',
        target: 'World',
        fact_value: totalMinutesPassed,
        context: 'Indexed world_state_events total'
      });
    }

    if (!skipLocation && newState.location && newState.location.toLowerCase() !== prevState.location?.toLowerCase()) {
      factsToSave.push({
        predicate: 'location_change',
        target: 'Party',
        fact_value: newState.location
      });
    }

    tools.logger.log('Extraction', `Calculated ${factsToSave.length} facts to save after diffing.`);

    if (factsToSave.length === 0) {
      tools.logger.log('Extraction', 'No state changes detected. No facts will be saved.');
      return true;
    }

    // --- PART 4: Database Insertion ---
    for (const fact of factsToSave) {
      await tools.facts.appendToFactsDb({
        source: fact.source || null,
        target: fact.target,
        predicate: fact.predicate,
        fact_value: fact.fact_value,
        context: fact.context || null
      }, { turn_number: turnNumber });
    }

    tools.logger.log('Extraction', `Successfully stored ${factsToSave.length} new world state facts for turn ${turnNumber}.`);
    return true;
  } catch (error) {
    tools.logger.error('Extraction', 'Failed to extract or store world state facts.', null, error);
  }
}

/**
 * Synthesizes a natural language summary of the world state based on extracted facts.
 * @param {TurnContext} turnContext - The TurnContext object.
 * @param {Object} tools - Plugin tools.
 * @param {number} targetTurn - The turn to synthesize for (defaults to current).
 * @param {Object} options - Synthesis options (e.g., skipLocation).
 * @returns {Promise<Object>} Object with structuredData, synthesizedText, and cleanSynthesizedText.
 */
async function synthesizeWorldState(turnContext, tools, targetTurn = null, options = {}) {
  const projectName = turnContext.projectName;
  const turnNumber = targetTurn || turnContext.turnNumber;
  const skipLocation = options.skipLocation || false;
  const settings = tools.settings.getSelf();

  // tools.logger.log('Synthesis', `synthesizeWorldState called for project: ${projectName}, turn: ${turnNumber}, skipLocation: ${skipLocation}`);

  try {
    const worldStateData = {};

    // 1. Get LAST location for each target (SKIP IF skipLocation is true)
    if (!skipLocation) {
      const locations = await tools.db.chat.query(
        `SELECT T1.target, T1.fact_value AS location
        FROM facts T1
        INNER JOIN (
            SELECT target, MAX(id) AS max_id
            FROM facts
            WHERE project_name = ? AND predicate = 'location_change' AND turn_number <= ?
            GROUP BY target
        ) AS T2
        ON T1.id = T2.max_id
        WHERE T1.project_name = ? AND T1.predicate = 'location_change' AND T1.turn_number <= ?;`,
        [projectName.toLowerCase(), turnNumber, projectName.toLowerCase(), turnNumber]
      );
      worldStateData.locations = locations.map(loc => `${loc.target} is at ${loc.location}`);
    } else {
      worldStateData.locations = [];
    }

    // 2. Get LAST weather_change
    const lastWeatherChange = await tools.db.chat.query(
      `SELECT fact_value AS weather
       FROM facts
       WHERE project_name = ? AND predicate = 'weather_change' AND turn_number <= ?
       ORDER BY turn_number DESC, id DESC
       LIMIT 1;`,
      [projectName.toLowerCase(), turnNumber]
    );
    worldStateData.weatherChange = lastWeatherChange[0] ? lastWeatherChange[0].weather : '';

    // 2b. Get LAST climate_change
    const lastClimateChange = await tools.db.chat.query(
      `SELECT fact_value AS climate
       FROM facts
       WHERE project_name = ? AND predicate = 'climate_change' AND turn_number <= ?
       ORDER BY turn_number DESC, id DESC
       LIMIT 1;`,
      [projectName.toLowerCase(), turnNumber]
    );
    worldStateData.climate = lastClimateChange[0] ? lastClimateChange[0].climate : '';

    // 3. CALCULATE THE DATE
    const totalTimeResult = await tools.db.chat.query(
      `SELECT SUM(fact_value) as total_minutes 
       FROM facts 
       WHERE project_name = ? AND predicate = 'quantitative_time_change' AND turn_number <= ?`,
      [projectName.toLowerCase(), turnNumber]
    );

    const totalMinutes = totalTimeResult[0]?.total_minutes || 0;

    const START_DAY = 1;
    const START_HOUR = 8;

    const absoluteMinutes = (START_HOUR * 60) + totalMinutes;
    const currentDay = Math.floor(absoluteMinutes / 1440) + START_DAY;
    const currentHour24 = Math.floor((absoluteMinutes % 1440) / 60);
    const currentMinute = absoluteMinutes % 60;

    const ampm = currentHour24 >= 12 ? 'PM' : 'AM';
    const displayHour = currentHour24 % 12 || 12;
    const displayMinute = currentMinute.toString().padStart(2, '0');

    worldStateData.formattedDate = `Day ${currentDay}, ${displayHour}:${displayMinute} ${ampm}`;

    // Calculate Period Programmatically
    const period = calculateTimePeriod(currentHour24, settings);
    worldStateData.qualitativeTime = period;

    // --- NEW: CALCULATE ELAPSED TIME FOR THIS TURN ---
    const turnTimeResult = await tools.db.chat.query(
      `SELECT SUM(fact_value) as turn_minutes 
       FROM facts 
       WHERE project_name = ? AND predicate = 'quantitative_time_change' AND turn_number = ?`,
      [projectName.toLowerCase(), turnNumber]
    );
    const turnMinutes = turnTimeResult[0]?.turn_minutes || 0;

    const elapsedDays = Math.floor(turnMinutes / 1440);
    const elapsedHours = Math.floor((turnMinutes % 1440) / 60);
    const elapsedMinutes = turnMinutes % 60;

    let elapsedParts = [];
    if (elapsedDays > 0) elapsedParts.push(`${elapsedDays} day${elapsedDays > 1 ? 's' : ''}`);
    if (elapsedHours > 0) elapsedParts.push(`${elapsedHours} hour${elapsedHours > 1 ? 's' : ''}`);
    if (elapsedMinutes > 0 || elapsedParts.length === 0) elapsedParts.push(`${elapsedMinutes} minute${elapsedMinutes > 1 ? 's' : ''}`);
    worldStateData.elapsedTime = elapsedParts.join(', ');

    // 5. GET SAFETY LEVEL
    const lastSafety = await tools.db.chat.query(
      `SELECT fact_value AS safety_level
         FROM facts
         WHERE project_name = ? AND predicate = 'safety_level_change' AND turn_number <= ?
         ORDER BY turn_number DESC, id DESC
         LIMIT 1;`,
      [projectName.toLowerCase(), turnNumber]
    );
    worldStateData.safetyLevel = lastSafety[0]?.safety_level || "Safe";

    // 6. GET CROWD DENSITY
    const lastCrowd = await tools.db.chat.query(
      `SELECT fact_value AS crowd_density
         FROM facts
         WHERE project_name = ? AND predicate = 'crowd_density_change' AND turn_number <= ?
         ORDER BY turn_number DESC, id DESC
         LIMIT 1;`,
      [projectName.toLowerCase(), turnNumber]
    );
    worldStateData.crowdDensity = lastCrowd[0]?.crowd_density || "Alone";

    // 7. Get inventory
    const inventory = await tools.db.chat.query(
      `SELECT target AS item, SUM(fact_value) AS quantity
       FROM facts
       WHERE project_name = ? AND predicate = 'inventory' AND turn_number <= ?
       GROUP BY target
       HAVING SUM(fact_value) > 0;`,
      [projectName.toLowerCase(), turnNumber]
    );

    // Fetch Metadata for each item
    for (const inv of inventory) {
      const iconRes = await tools.db.chat.query(
        `SELECT fact_value FROM facts 
         WHERE project_name = ? AND target = ? AND predicate = 'inventory_icon' AND turn_number <= ? 
         ORDER BY turn_number DESC, id DESC LIMIT 1`,
        [projectName.toLowerCase(), inv.item, turnNumber]
      );
      inv.icon = iconRes[0]?.fact_value || '📦';

      const descRes = await tools.db.chat.query(
        `SELECT fact_value FROM facts 
         WHERE project_name = ? AND target = ? AND predicate = 'inventory_description' AND turn_number <= ? 
         ORDER BY turn_number DESC, id DESC LIMIT 1`,
        [projectName.toLowerCase(), inv.item, turnNumber]
      );
      inv.description = descRes[0]?.fact_value || '';

      const originRes = await tools.db.chat.query(
        `SELECT context FROM facts 
         WHERE project_name = ? AND target = ? AND predicate = 'inventory' AND fact_value > 0 AND turn_number <= ? 
         ORDER BY turn_number DESC, id DESC LIMIT 1`,
        [projectName.toLowerCase(), inv.item, turnNumber]
      );
      inv.origin = originRes[0]?.context || '';
    }
    worldStateData.inventory = inventory;

    // --- Phase 2: SYNTHESIS ---
    const parts = [];
    const cleanParts = [];

    // Part 1: Time
    parts.push(`It is currently ${worldStateData.qualitativeTime} (${worldStateData.formattedDate}). Consider the time of day when writing, you should be aware of stuff such as day light vs night time, lunch/dinner time, time to go to sleep, etc.\n*Every* character must be aware of the current time and make their decisions accordingly.\n If your scene advances time in a major way, make it explicit in the narrative text.`);
    cleanParts.push(`It is currently ${worldStateData.formattedDate}.`);

    parts.push(`Total elapsed time since the start of the adventure: ${worldStateData.elapsedTime}.`);
    cleanParts.push(`Total elapsed time since the start of the adventure: ${worldStateData.elapsedTime}.`);

    if (worldStateData.weatherChange) {
      parts.push(`The weather is ${worldStateData.weatherChange}.`);
      cleanParts.push(`The weather is ${worldStateData.weatherChange}.`);
    }

    if (worldStateData.climate) {
      parts.push(`The climate is ${worldStateData.climate}.`);
      cleanParts.push(`The climate is ${worldStateData.climate}.`);
    }

    parts.push(`Safety Level: ${worldStateData.safetyLevel}. Crowd Density: ${worldStateData.crowdDensity}.`);
    cleanParts.push(`Safety Level: ${worldStateData.safetyLevel}. Crowd Density: ${worldStateData.crowdDensity}.`);

    if (worldStateData.locations.length > 0) {
      parts.push(`Current location: ${worldStateData.locations.join(', ')}.`);
      cleanParts.push(`Current location: ${worldStateData.locations.join(', ')}.`);
    }

    if (worldStateData.inventory.length > 0) {
      const invStrings = worldStateData.inventory.map(inv => {
        let s = `${inv.item}: ${inv.quantity}`;
        if (inv.description) s += ` (${inv.description})`;
        if (inv.origin) s += ` [Origin: ${inv.origin}]`;
        return s + "\n";
      });
      parts.push(`Party Inventory: \n-${invStrings.join('-')}`);
      cleanParts.push(`Party Inventory: \n-${invStrings.join('-')}`);
    }

    const synthesizedText = parts.join("\n");
    const cleanSynthesizedText = cleanParts.join("\n");

    return {
      structuredData: worldStateData,
      synthesizedText: synthesizedText,
      cleanSynthesizedText: cleanSynthesizedText
    };
  } catch (error) {
    tools.logger.error('Synthesis', 'Failed to synthesize world state:', null, error);
    return { structuredData: null, synthesizedText: null, cleanSynthesizedText: null };
  }
}

async function synthesizeWorldStateForDialogue(turnContext, tools, targetTurn, dialogueIndex = null, options = {}) {
  const hasLocationTracker = options.skipLocation || false;
  const settings = tools.settings.getSelf();
  let baselineStructuredData = null;

  if (Number(targetTurn || 0) <= 1) {
    baselineStructuredData = createDefaultStructuredData(settings);
  } else {
    const baseline = await synthesizeWorldState(turnContext, tools, targetTurn - 1, { skipLocation: hasLocationTracker });
    baselineStructuredData = baseline?.structuredData || createDefaultStructuredData(settings);
  }

  const timeline = await getWorldStateTimelineForTurn(turnContext, tools, targetTurn);
  if (!Array.isArray(timeline) || timeline.length === 0) {
    throw new Error(`Missing indexed world-state events for turn ${targetTurn}. Recreate the project data with this pre-release build.`);
  }
  const structuredData = applyTimelineEventsToStructuredData(
    baselineStructuredData,
    timeline,
    dialogueIndex,
    settings
  );

  if (hasLocationTracker) {
    structuredData.locations = [];
  }

  const synthesized = buildSynthesisTextFromStructuredData(structuredData);
  return {
    structuredData,
    synthesizedText: synthesized.synthesizedText,
    cleanSynthesizedText: synthesized.cleanSynthesizedText
  };
}

function normalizeAnchorKey(anchorNode) {
  return String(anchorNode || '').trim().toLowerCase();
}

function normalizeLocationEventPayload(event = {}, turnNumber = 0) {
  const anchorNode = String(event.anchor_node || event.anchorNode || event.location || '').trim();
  if (!anchorNode) return null;

  return {
    anchor_node: anchorNode,
    event: String(event.event || event.description || '').replace(/\s+/g, ' ').trim(),
    status: String(event.status || 'active').replace(/\s+/g, ' ').trim().toLowerCase() || 'active',
    trajectory: String(event.trajectory || 'stable').replace(/\s+/g, ' ').trim().toLowerCase() || 'stable',
    salience: Math.max(1, Math.min(5, Math.round(Number(event.salience) || 3))),
    reason: String(event.reason || '').replace(/\s+/g, ' ').trim(),
    updated_turn: Number.isInteger(Number(event.updated_turn)) ? Number(event.updated_turn) : turnNumber
  };
}

async function upsertLocationEvent(turnContext, tools, event = {}, options = {}) {
  const turnNumber = Number.isInteger(Number(options.turnNumber))
    ? Number(options.turnNumber)
    : (turnContext?.turnNumber || tools.turnContext?.turnNumber || 0);
  const payload = normalizeLocationEventPayload(event, turnNumber);
  if (!payload || !payload.event) return { saved: false, reason: 'invalid_event' };

  await tools.facts.appendToFactsDb({
    source: 'world',
    target: normalizeAnchorKey(payload.anchor_node),
    predicate: 'WORLD_LOCATION_EVENT',
    fact_value: JSON.stringify(payload),
    context: options.context || 'world_simulator'
  }, { turn_number: turnNumber });

  return { saved: true, event: payload };
}

async function getLocationEvents(turnContext, tools, options = {}) {
  const projectName = String(turnContext?.projectName || tools.turnContext?.projectName || '').toLowerCase();
  if (!projectName) return [];
  const turnNumber = Number.isInteger(Number(options.turnNumber))
    ? Number(options.turnNumber)
    : (turnContext?.turnNumber || tools.turnContext?.turnNumber || 0);

  const rows = await tools.db.chat.query(
    `SELECT f.target, f.fact_value, f.turn_number
     FROM facts f
     INNER JOIN (
       SELECT target, MAX(id) AS max_id
       FROM facts
       WHERE project_name = ? AND predicate = 'WORLD_LOCATION_EVENT' AND turn_number <= ?
       GROUP BY target
     ) latest ON latest.max_id = f.id
     WHERE f.project_name = ? AND f.predicate = 'WORLD_LOCATION_EVENT'
     ORDER BY f.turn_number DESC, f.id DESC`,
    [projectName, turnNumber, projectName]
  );

  return (rows || []).map(row => {
    try {
      const parsed = JSON.parse(row.fact_value || '{}');
      return { ...parsed, anchor_key: row.target, turn_number: row.turn_number };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function getLocationEvent(turnContext, tools, anchorNode, options = {}) {
  const key = normalizeAnchorKey(anchorNode);
  if (!key) return null;
  const events = await getLocationEvents(turnContext, tools, options);
  return events.find(event => normalizeAnchorKey(event.anchor_node) === key || event.anchor_key === key) || null;
}


module.exports = {
  extractAndStoreWorldState,
  synthesizeWorldState,
  synthesizeWorldStateForDialogue,
  buildTimeTitleContributions,
  applyInventoryDisposalIntentToEvents,
  buildPreviousTurnUpdate,
  buildWorldStateUpdateBrief,
  upsertLocationEvent,
  getLocationEvents,
  getLocationEvent
};
