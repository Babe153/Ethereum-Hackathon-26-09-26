import type { Metadata } from 'next';
import BountyApp from '../../bounty-app';
export const metadata: Metadata = { title: 'Post a task | ProofPay' };
export default function PostPage() { return <BountyApp locale="en" view="post" />; }
