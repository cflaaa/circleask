/**
 * core/index.js —— 功能层门面
 *
 * 层：core（功能层）
 * 界面只 import 这个文件，不 import 具体 service。
 * 好处：以后内部怎么拆都行，界面的 import 路径永远不变。
 */

import { createBus } from './bus.js';
import { assertPort } from './ports/contract.js';
import { StoragePort } from './ports/storage-port.js';
import { PageRendererPort } from './ports/page-renderer-port.js';
import { VisionPort } from './ports/vision-port.js';
import { ClockPort } from './ports/clock-port.js';
import { createLibraryService } from './services/library-service.js';
import { createReaderService } from './services/reader-service.js';
import { createAskService } from './services/ask-service.js';

/**
 * @param {Object} deps
 * @param {Object} deps.storage  实现 StoragePort
 * @param {Object} deps.renderer 实现 PageRendererPort
 * @param {Object} deps.vision   实现 VisionPort
 * @param {Object} deps.clock    实现 ClockPort
 * @param {Object} [deps.ids]    { next(): string }
 */
export function createCore({ storage, renderer, vision, clock, ids }) {
  assertPort(storage, StoragePort, 'StoragePort');
  assertPort(renderer, PageRendererPort, 'PageRendererPort');
  assertPort(vision, VisionPort, 'VisionPort');
  assertPort(clock, ClockPort, 'ClockPort');

  const idGen = ids || { next: () => Math.random().toString(36).slice(2, 10) };
  const bus = createBus();

  const library = createLibraryService({ storage, renderer, clock, bus, ids: idGen });
  const reader = createReaderService({ storage, renderer, clock, bus });
  const ask = createAskService({ vision, storage, clock, bus, ids: idGen });

  return { bus, library, reader, ask };
}
