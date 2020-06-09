import {
  cacheMethodResult,
  cacheMethodResultInMinimongo,
} from './lib/enhanced-methods/enhanced-methods-data-handlers-client';
import './lib/pub-sub-lite/pub-sub-lite-client';
import './lib/blaze/blaze-template-subscribe-lite';
import './lib/blaze/blaze-view-subscribe-lite';
import PubSubLiteConfig from './lib/config';
import { mergeDataIntoMinimongo } from './lib/utils';

export const PubSubLite = {
  disableSubsCache: () => PubSubLiteConfig.disableSubsCache(),
  setDefaultSubsCacheDurationMs: ms =>
    PubSubLiteConfig.setDefaultSubsCacheDurationMs(ms),
  disableMethodCallCache: () => PubSubLiteConfig.disableMethodCallCache(),
  setDefaultMethodCallCacheDurationMs: ms =>
    PubSubLiteConfig.setDefaultMethodCallCacheDurationMs(ms),
  mergeDataIntoMinimongo,
  cacheMethodResult,
  cacheMethodResultInMinimongo,
};
