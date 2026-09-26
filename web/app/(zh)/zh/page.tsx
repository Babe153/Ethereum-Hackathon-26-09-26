import type { Metadata } from 'next';
import BountyApp from '../../bounty-app';
export const metadata: Metadata = {
  title: '任务广场｜ProofPay',
  description: '浏览链上悬赏，连接钱包接单、交付成果，查看 DeepSeek 验收报告。',
  alternates: { canonical: '/zh', languages: { en: '/', 'zh-CN': '/zh' } },
};
export default function ChineseMarketplacePage() { return <BountyApp locale="zh" view="market" />; }
