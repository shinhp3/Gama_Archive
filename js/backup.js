// ===== 기록 파일 =====
// 같은 브라우저는 저장소에 바로 남은 기록을 다시 연다.
// 다른 브라우저는 파일로 저장한 뒤 그 파일을 불러온다.

import * as db from './db.js?v=0.3.28';
import { sanitizeKiln } from './kilns.js?v=0.3.28';

function sanitizeFiring(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.kilnId !== 'string' || !raw.kilnId) return null;
  if (typeof raw.startedAt !== 'number' || !isFinite(raw.startedAt)) return null;
  const name = typeof raw.kilnName === 'string' ? raw.kilnName.trim().slice(0, 80) : '';
  return {
    id: raw.id,
    kilnId: raw.kilnId,
    kilnName: name,
    startedAt: raw.startedAt,
    endedAt: typeof raw.endedAt === 'number' && isFinite(raw.endedAt) ? raw.endedAt : null
  };
}

function sanitizeReading(raw) {
  if (!raw || typeof raw.firingId !== 'string' || !raw.firingId) return null;
  if (typeof raw.ts !== 'number' || !isFinite(raw.ts)) return null;
  const quality = raw.quality === 'insufficient' || raw.quality === 'missing' ? raw.quality : 'normal';
  const reading = {
    firingId: raw.firingId,
    ts: raw.ts,
    temp: typeof raw.temp === 'number' && isFinite(raw.temp) ? raw.temp : null,
    confidence: typeof raw.confidence === 'number' && isFinite(raw.confidence) ? raw.confidence : null,
    validSampleCount: typeof raw.validSampleCount === 'number' && isFinite(raw.validSampleCount) ? raw.validSampleCount : 0,
    quality,
    edited: raw.edited === true,
    originalTemp: typeof raw.originalTemp === 'number' && isFinite(raw.originalTemp) ? raw.originalTemp : null,
    editedAt: typeof raw.editedAt === 'number' && isFinite(raw.editedAt) ? raw.editedAt : null
  };
  if (typeof raw.id === 'number' && isFinite(raw.id) && raw.id > 0) reading.id = raw.id;
  return reading;
}

export async function exportArchive() {
  const kilns = await db.getKilns();
  const firings = await db.getAllFirings();
  const readings = await db.getAllReadings();
  return {
    app: 'Gama_Archive',
    format: 1,
    exportedAt: Date.now(),
    kilns: kilns || [],
    firings: firings || [],
    readings: readings || []
  };
}

export function parseArchive(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('기록 파일을 읽지 못했습니다.');
  }
  if (!data || data.app !== 'Gama_Archive' || !Array.isArray(data.kilns) || !Array.isArray(data.firings) || !Array.isArray(data.readings)) {
    throw new Error('이 앱의 기록 파일이 아닙니다.');
  }
  const kilns = data.kilns.map(sanitizeKiln).filter(Boolean);
  const firings = data.firings.map(sanitizeFiring).filter(Boolean);
  const firingIds = {};
  firings.forEach((firing) => { firingIds[firing.id] = true; });
  const readings = data.readings.map(sanitizeReading).filter((reading) => reading && firingIds[reading.firingId]);
  if (!kilns.length && !firings.length) throw new Error('파일에 넣을 기록이 없습니다.');
  return { kilns, firings, readings };
}

export async function importArchive(archive) {
  const kilns = await db.putRecords('kilns', archive.kilns);
  const firings = await db.putRecords('firings', archive.firings);
  const readings = await db.putRecords('readings', archive.readings);
  return { kilns, firings, readings };
}
