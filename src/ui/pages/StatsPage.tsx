import { A } from '@solidjs/router';
import { For, Show, createResource } from 'solid-js';
import type { UsageStats } from '../../domain/usage.ts';
import { cacheHitRate, dailyCosts, errorRate, formatMs, formatUsd, serviceLabel, type StatsClient } from './stats-view.ts';
import './StatsPage.css';

const CHART_W = 600;
const CHART_H = 160;

function CostChart(props: { stats: UsageStats }) {
  const days = () => dailyCosts(props.stats, new Date());
  const max = () => Math.max(...days().map((d) => d.costUsd), 0);
  const slot = () => CHART_W / days().length;
  return (
    <svg class="stats-chart" viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`} role="img" aria-label="일별 비용 막대 차트">
      <line x1="0" y1={CHART_H} x2={CHART_W} y2={CHART_H} class="stats-axis" />
      <For each={days()}>
        {(d, i) => {
          const h = () => (max() > 0 ? Math.max((d.costUsd / max()) * (CHART_H - 8), d.costUsd > 0 ? 2 : 0) : 0);
          return (
            <g>
              <rect class="stats-bar" x={i() * slot() + slot() * 0.15} width={slot() * 0.7} y={CHART_H - h()} height={h()}>
                <title>{`${d.day} ${formatUsd(d.costUsd)}`}</title>
              </rect>
              <Show when={days().length <= 10 || i() % 5 === 0 || i() === days().length - 1}>
                <text class="stats-tick" x={i() * slot() + slot() / 2} y={CHART_H + 14} text-anchor="middle">{d.day.slice(5)}</text>
              </Show>
            </g>
          );
        }}
      </For>
    </svg>
  );
}

export function StatsPage(props: { client: StatsClient }) {
  const [outcome, { refetch }] = createResource(() => props.client.get());
  return (
    <main class="stats-page">
      <header class="stats-header">
        <h1>Stats</h1>
        <A href="/" class="stats-home">홈</A>
      </header>
      <Show when={!outcome.loading} fallback={<p role="status">불러오는 중…</p>}>
        <Show
          when={outcome()?.ok ? (outcome() as { ok: true; value: UsageStats }).value : undefined}
          fallback={(
            <div role="alert" class="stats-error">
              <p>{(outcome() as { ok: false; reason: string } | undefined)?.reason ?? 'Stats 통계를 불러오지 못했습니다.'}</p>
              <button type="button" onClick={() => void refetch()}>다시 시도</button>
            </div>
          )}
        >
          {(stats) => (
            <>
              <p class="stats-period">최근 {stats().days}일 (UTC)</p>
              <dl class="stats-totals">
                <div><dt>호출</dt><dd>{stats().totals.calls.toLocaleString('ko-KR')}</dd></div>
                <div><dt>오류율</dt><dd>{errorRate(stats().totals.calls, stats().totals.errors)}</dd></div>
                <div><dt>캐시 적중률</dt><dd>{cacheHitRate(stats().totals.inputTokens, stats().totals.cachedTokens)}</dd></div>
                <div><dt>비용</dt><dd>{formatUsd(stats().totals.costUsd)}</dd></div>
              </dl>
              <h2>서비스별</h2>
              <div class="stats-table-wrap">
                <table class="stats-table">
                  <thead><tr><th>서비스</th><th>호출</th><th>오류율</th><th>평균 지연</th><th>비용</th></tr></thead>
                  <tbody>
                    <For each={stats().byService} fallback={<tr><td colspan="5">기록이 없습니다.</td></tr>}>
                      {(row) => (
                        <tr>
                          <th scope="row">{serviceLabel(row.service)}</th>
                          <td>{row.calls.toLocaleString('ko-KR')}</td>
                          <td>{errorRate(row.calls, row.errors)}</td>
                          <td>{formatMs(row.avgMs)}</td>
                          <td>{formatUsd(row.costUsd)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <h2>일별 비용</h2>
              <CostChart stats={stats()} />
            </>
          )}
        </Show>
      </Show>
    </main>
  );
}
