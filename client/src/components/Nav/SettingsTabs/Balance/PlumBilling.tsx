/* eslint-disable i18next/no-literal-string */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthContext } from '~/hooks';

type PlumPlan = {
  id: string;
  label: string;
  plmAmount: string;
  plmAmountWei: string;
  creditsGranted: number;
};

type PlumMe = {
  walletAddress: string | null;
  billingMode: 'agent-free' | 'paid';
  isAgentFree: boolean;
  balance: number;
  plans: PlumPlan[];
  payment?: {
    chainId?: number;
    treasuryAddress?: string;
    minConfirmations?: number;
  };
};

type PlumUsage = {
  summary: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    spentCredits: number;
    addedCredits: number;
    waivedCredits: number;
    netCredits: number;
  };
};

type Eip1193Provider = {
  isPlumWallet?: boolean;
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<any>;
};

function getProvider(): Eip1193Provider | null {
  const plumise = (window as any).plumise?.ethereum;
  if (plumise) return plumise;

  const providers = (window as any).ethereum?.providers;
  if (Array.isArray(providers)) {
    const plumProvider = providers.find((p: Eip1193Provider) => p.isPlumWallet === true);
    if (plumProvider) return plumProvider;
  }

  if ((window as any).ethereum?.isPlumWallet) return (window as any).ethereum;
  return (window as any).ethereum ?? null;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

function PlumBilling() {
  const { isAuthenticated } = useAuthContext();
  const [me, setMe] = useState<PlumMe | null>(null);
  const [usage, setUsage] = useState<PlumUsage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [submitPlanId, setSubmitPlanId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [meRes, usageRes] = await Promise.all([
        fetch('/api/plum/me', { credentials: 'include' }),
        fetch('/api/plum/usage', { credentials: 'include' }),
      ]);

      if (!meRes.ok) {
        const body = await meRes.json().catch(() => ({}));
        throw new Error(body?.message || 'Failed to load Plum billing state');
      }

      if (!usageRes.ok) {
        const body = await usageRes.json().catch(() => ({}));
        throw new Error(body?.message || 'Failed to load Plum usage');
      }

      const meData = (await meRes.json()) as PlumMe;
      const usageData = (await usageRes.json()) as PlumUsage;
      setMe(meData);
      setUsage(usageData);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to load Plum billing data');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const walletLabel = useMemo(() => {
    if (!me?.walletAddress) {
      return 'Not connected';
    }
    return `${me.walletAddress.slice(0, 6)}...${me.walletAddress.slice(-4)}`;
  }, [me?.walletAddress]);

  const payPlan = useCallback(
    async (plan: PlumPlan) => {
      if (!me?.payment?.treasuryAddress) {
        setErrorMessage('Treasury wallet is not configured on the server');
        return;
      }

      const provider = getProvider();
      if (!provider) {
        setErrorMessage('No wallet provider found. Install PlumWallet or MetaMask.');
        return;
      }

      setSubmitPlanId(plan.id);
      setErrorMessage(null);
      setStatusMessage(null);

      try {
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        const from = accounts?.[0];
        if (!from) {
          throw new Error('No wallet account selected');
        }

        if (me.payment.chainId) {
          const targetChainHex = `0x${Number(me.payment.chainId).toString(16)}`;
          const currentChainHex = await provider.request({ method: 'eth_chainId' });
          if (
            typeof currentChainHex === 'string' &&
            currentChainHex.toLowerCase() !== targetChainHex.toLowerCase()
          ) {
            await provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: targetChainHex }],
            });
          }
        }

        const valueHex = `0x${BigInt(plan.plmAmountWei).toString(16)}`;
        const txHash = await provider.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from,
              to: me.payment.treasuryAddress,
              value: valueHex,
            },
          ],
        });

        if (!txHash) {
          throw new Error('Transaction hash not returned');
        }

        const verifyRes = await fetch('/api/plum/payments/verify', {
          method: 'POST',
          credentials: 'include',
          headers: jsonHeaders,
          body: JSON.stringify({
            planId: plan.id,
            txHash,
          }),
        });

        const verifyBody = await verifyRes.json().catch(() => ({}));
        if (!verifyRes.ok) {
          throw new Error(verifyBody?.message || 'Payment verification failed');
        }

        setStatusMessage(`Payment confirmed: ${txHash.slice(0, 10)}...`);
        await fetchState();
      } catch (error: any) {
        setErrorMessage(error?.message || 'Payment failed');
      } finally {
        setSubmitPlanId(null);
      }
    },
    [fetchState, me],
  );

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border-light p-4">
      <div className="mb-2 text-sm font-semibold text-text-primary">Plum Billing</div>
      <div className="mb-1 text-xs text-text-secondary">Wallet: {walletLabel}</div>
      <div className="mb-3 text-xs text-text-secondary">
        Mode: {me?.billingMode === 'agent-free' ? 'Agent-Free' : 'Paid'}
      </div>

      {usage && (
        <div className="mb-3 rounded-lg bg-surface-tertiary p-3 text-xs text-text-primary">
          <div>Total Tokens (7d): {new Intl.NumberFormat().format(usage.summary.totalTokens)}</div>
          <div>Spent Credits (7d): {usage.summary.spentCredits.toFixed(2)}</div>
          <div>Waived Credits (7d): {usage.summary.waivedCredits.toFixed(2)}</div>
        </div>
      )}

      <div className="grid gap-2">
        {(me?.plans || []).map((plan) => {
          const disabled =
            !!submitPlanId || !me?.payment?.treasuryAddress || me?.isAgentFree === true;

          return (
            <div
              key={plan.id}
              className="flex items-center justify-between rounded-lg border border-border-light p-3"
            >
              <div>
                <div className="text-sm font-medium text-text-primary">{plan.label}</div>
                <div className="text-xs text-text-secondary">
                  {plan.plmAmount} PLM / +{new Intl.NumberFormat().format(plan.creditsGranted)}{' '}
                  credits
                </div>
              </div>
              <button
                type="button"
                onClick={() => void payPlan(plan)}
                disabled={disabled}
                className="rounded-md border border-border-light px-3 py-1 text-xs text-text-primary disabled:opacity-50"
              >
                {submitPlanId === plan.id
                  ? 'Processing...'
                  : me?.isAgentFree
                    ? 'Agent-Free Active'
                    : 'Pay'}
              </button>
            </div>
          );
        })}
      </div>

      {isLoading && <div className="mt-3 text-xs text-text-secondary">Loading...</div>}
      {statusMessage && <div className="mt-3 text-xs text-green-600">{statusMessage}</div>}
      {errorMessage && <div className="mt-3 text-xs text-red-600">{errorMessage}</div>}
    </div>
  );
}

export default React.memo(PlumBilling);
