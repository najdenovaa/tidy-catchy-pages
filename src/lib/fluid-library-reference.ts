/** Project-owned provenance. Library changes never resolve or mutate this snapshot. */
export interface FluidLibraryReference {
  entryId: string;
  revision: number;
  name: string;
  source: string;
  notes?: string;
  basis: 'user' | 'laboratory' | 'manufacturer' | 'estimate';
  temperatureC?: number;
  pressureMPa?: number;
  appliedAt: string;
  signature: string;
}
export function normalizeFluidLibraryReference(value: unknown): FluidLibraryReference | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (typeof v.entryId !== 'string' || !v.entryId || v.entryId.length > 200 || !Number.isInteger(v.revision) || Number(v.revision) < 1 ||
      typeof v.name !== 'string' || v.name.length > 200 || typeof v.source !== 'string' || v.source.length > 2000 ||
      !['user', 'laboratory', 'manufacturer', 'estimate'].includes(String(v.basis)) ||
      typeof v.appliedAt !== 'string' || !Number.isFinite(Date.parse(v.appliedAt)) ||
      typeof v.signature !== 'string' || v.signature.length > 200000) return;
  return {entryId:v.entryId, revision:Number(v.revision), name:v.name, source:v.source,
    ...(typeof v.notes === 'string' && v.notes.length <= 4000 ? {notes:v.notes}:{}),
    basis:v.basis as FluidLibraryReference['basis'], appliedAt:v.appliedAt, signature:v.signature,
    ...(typeof v.temperatureC === 'number' && Number.isFinite(v.temperatureC) ? {temperatureC:v.temperatureC}:{}),
    ...(typeof v.pressureMPa === 'number' && Number.isFinite(v.pressureMPa) && v.pressureMPa >= 0 ? {pressureMPa:v.pressureMPa}:{})};
}
