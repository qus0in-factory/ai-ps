export function ReportPanel(props: { report: string }) {
  return <section class="talk-report" aria-labelledby="talk-report-title">
    <span class="talk-eyebrow">오늘의 연습</span>
    <h2 id="talk-report-title">오늘의 학습 보고서</h2>
    <p>{props.report}</p>
  </section>;
}
