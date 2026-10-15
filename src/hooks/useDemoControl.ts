// src/hooks/useDemoControl.ts —— Mock 模式下的 DemoControl（HTTP 模式為 null）
import { useMemo } from 'react';
import { getDemoControl } from '@/services/api/createApiClient';
import { useApi } from './useApi';

export function useDemoControl() {
  const api = useApi();
  return useMemo(() => getDemoControl(api), [api]);
}
