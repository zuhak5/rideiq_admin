import { handle as handleAdminAlertingStatus } from './routes/admin-alerting-status.ts';
import { handle as handleAdminDashboardSummary } from './routes/admin-dashboard-summary.ts';
import { handle as handleAdminDriverDetail } from './routes/admin-driver-detail.ts';
import { handle as handleAdminDriverTransition } from './routes/admin-driver-transition.ts';
import { handle as handleAdminDriversList } from './routes/admin-drivers-list.ts';
import { handle as handleAdminFraudActions } from './routes/admin-fraud-actions.ts';
import { handle as handleAdminFraudCases } from './routes/admin-fraud-cases.ts';
import { handle as handleAdminObservability } from './routes/admin-observability.ts';
import { handle as handleAdminPaymentDetail } from './routes/admin-payment-detail.ts';
import { handle as handleAdminPaymentRefund } from './routes/admin-payment-refund.ts';
import { handle as handleAdminPaymentsList } from './routes/admin-payments-list.ts';
import { handle as handleAdminPayoutJobAction } from './routes/admin-payout-job-action.ts';
import { handle as handleAdminPayoutJobCreate } from './routes/admin-payout-job-create.ts';
import { handle as handleAdminPayoutJobDetail } from './routes/admin-payout-job-detail.ts';
import { handle as handleAdminPayoutJobsList } from './routes/admin-payout-jobs-list.ts';
import { handle as handleAdminRideCancel } from './routes/admin-ride-cancel.ts';
import { handle as handleAdminRideDetail } from './routes/admin-ride-detail.ts';
import { handle as handleAdminRideIntentConvert } from './routes/admin-ride-intent-convert.ts';
import { handle as handleAdminRidesList } from './routes/admin-rides-list.ts';
import { handle as handleAdminSloSummary } from './routes/admin-slo-summary.ts';
import { handle as handleAdminUsersList } from './routes/admin-users-list.ts';
import { handle as handleAdminWithdrawalDetail } from './routes/admin-withdrawal-detail.ts';
import { handle as handleAdminWithdrawalsList } from './routes/admin-withdrawals-list.ts';
import { handle as handleAdminWithdrawApprove } from './routes/admin-withdraw-approve.ts';
import { handle as handleAdminWithdrawMarkPaid } from './routes/admin-withdraw-mark-paid.ts';
import { handle as handleAdminWithdrawReject } from './routes/admin-withdraw-reject.ts';
import { handle as handleAdminServiceAreasList } from './routes/admin-service-areas-list.ts';
import { handle as handleAdminServiceAreaUpsert } from './routes/admin-service-area-upsert.ts';
import { handle as handleAdminServiceAreaDelete } from './routes/admin-service-area-delete.ts';
import { handle as handleAdminPricingConfigsList } from './routes/admin-pricing-configs-list.ts';
import { handle as handleAdminPricingConfigSetDefault } from './routes/admin-pricing-config-set-default.ts';
import { handle as handleAdminPricingConfigUpdateCaps } from './routes/admin-pricing-config-update-caps.ts';
import { handle as handleAdminPricingConfigClone } from './routes/admin-pricing-config-clone.ts';
import { handle as handleAdminLiveDrivers } from './routes/admin-live-drivers.ts';
import { handle as handleAdminGiftCodesList } from './routes/admin-gift-codes-list.ts';
import { handle as handleAdminGiftCodesGenerate } from './routes/admin-gift-codes-generate.ts';
import { handle as handleAdminGiftCodeVoid } from './routes/admin-gift-code-void.ts';
import { handle as handleAdminMerchantPromotionsList } from './routes/admin-merchant-promotions-list.ts';
import { handle as handleAdminMerchantPromotionToggle } from './routes/admin-merchant-promotion-toggle.ts';
import { handle as handleAdminReferralCampaignsList } from './routes/admin-referral-campaigns-list.ts';
import { handle as handleAdminReferralCampaignUpdate } from './routes/admin-referral-campaign-update.ts';
import { handle as handleAdminSupportTicketsList } from './routes/admin-support-tickets-list.ts';
import { handle as handleAdminSupportTicketGet } from './routes/admin-support-ticket-get.ts';
import { handle as handleAdminSupportTicketAssign } from './routes/admin-support-ticket-assign.ts';
import { handle as handleAdminSupportTicketSetStatus } from './routes/admin-support-ticket-set-status.ts';
import { handle as handleAdminSupportTicketReply } from './routes/admin-support-ticket-reply.ts';
import { handle as handleAdminSupportTicketAddNote } from './routes/admin-support-ticket-add-note.ts';
import { handle as handleAdminSupportSectionsList } from './routes/admin-support-sections-list.ts';
import { handle as handleAdminSupportSectionUpsert } from './routes/admin-support-section-upsert.ts';
import { handle as handleAdminSupportArticlesList } from './routes/admin-support-articles-list.ts';
import { handle as handleAdminSupportArticleGet } from './routes/admin-support-article-get.ts';
import { handle as handleAdminSupportArticleUpsert } from './routes/admin-support-article-upsert.ts';
import { handle as handleAdminMerchantsList } from './routes/admin-merchants-list.ts';
import { handle as handleAdminMerchantGet } from './routes/admin-merchant-get.ts';
import { handle as handleAdminMerchantSetStatus } from './routes/admin-merchant-set-status.ts';
import { handle as handleAdminOrdersList } from './routes/admin-orders-list.ts';
import { handle as handleAdminOrderGet } from './routes/admin-order-get.ts';
import { handle as handleAdminOrderSetStatus } from './routes/admin-order-set-status.ts';

export type RouteHandler = (req: Request, ctx: any) => Promise<Response>;

export const ROUTES: Record<string, RouteHandler> = {
  'admin-alerting-status': handleAdminAlertingStatus,
  'admin-dashboard-summary': handleAdminDashboardSummary,
  'admin-driver-detail': handleAdminDriverDetail,
  'admin-driver-transition': handleAdminDriverTransition,
  'admin-drivers-list': handleAdminDriversList,
  'admin-fraud-actions': handleAdminFraudActions,
  'admin-fraud-cases': handleAdminFraudCases,
  'admin-observability': handleAdminObservability,
  'admin-payment-detail': handleAdminPaymentDetail,
  'admin-payment-refund': handleAdminPaymentRefund,
  'admin-payments-list': handleAdminPaymentsList,
  'admin-payout-jobs-list': handleAdminPayoutJobsList,
  'admin-payout-job-detail': handleAdminPayoutJobDetail,
  'admin-payout-job-create': handleAdminPayoutJobCreate,
  'admin-payout-job-action': handleAdminPayoutJobAction,
  'admin-ride-cancel': handleAdminRideCancel,
  'admin-ride-detail': handleAdminRideDetail,
  'admin-ride-intent-convert': handleAdminRideIntentConvert,
  'admin-rides-list': handleAdminRidesList,
  'admin-slo-summary': handleAdminSloSummary,
  'admin-users-list': handleAdminUsersList,
  'admin-withdrawals-list': handleAdminWithdrawalsList,
  'admin-withdrawal-detail': handleAdminWithdrawalDetail,
  'admin-withdraw-approve': handleAdminWithdrawApprove,
  'admin-withdraw-reject': handleAdminWithdrawReject,
  'admin-withdraw-mark-paid': handleAdminWithdrawMarkPaid,
  'admin-service-areas-list': handleAdminServiceAreasList,
  'admin-service-area-upsert': handleAdminServiceAreaUpsert,
  'admin-service-area-delete': handleAdminServiceAreaDelete,
  'admin-pricing-configs-list': handleAdminPricingConfigsList,
  'admin-pricing-config-set-default': handleAdminPricingConfigSetDefault,
  'admin-pricing-config-update-caps': handleAdminPricingConfigUpdateCaps,
  'admin-pricing-config-clone': handleAdminPricingConfigClone,
  'admin-live-drivers': handleAdminLiveDrivers,
  'admin-gift-codes-list': handleAdminGiftCodesList,
  'admin-gift-codes-generate': handleAdminGiftCodesGenerate,
  'admin-gift-code-void': handleAdminGiftCodeVoid,
  'admin-merchant-promotions-list': handleAdminMerchantPromotionsList,
  'admin-merchant-promotion-toggle': handleAdminMerchantPromotionToggle,
  'admin-referral-campaigns-list': handleAdminReferralCampaignsList,
  'admin-referral-campaign-update': handleAdminReferralCampaignUpdate,
  'admin-support-tickets-list': handleAdminSupportTicketsList,
  'admin-support-ticket-get': handleAdminSupportTicketGet,
  'admin-support-ticket-assign': handleAdminSupportTicketAssign,
  'admin-support-ticket-set-status': handleAdminSupportTicketSetStatus,
  'admin-support-ticket-reply': handleAdminSupportTicketReply,
  'admin-support-ticket-add-note': handleAdminSupportTicketAddNote,
  'admin-support-sections-list': handleAdminSupportSectionsList,
  'admin-support-section-upsert': handleAdminSupportSectionUpsert,
  'admin-support-articles-list': handleAdminSupportArticlesList,
  'admin-support-article-get': handleAdminSupportArticleGet,
  'admin-support-article-upsert': handleAdminSupportArticleUpsert,
  'admin-merchants-list': handleAdminMerchantsList,
  'admin-merchant-get': handleAdminMerchantGet,
  'admin-merchant-set-status': handleAdminMerchantSetStatus,
  'admin-orders-list': handleAdminOrdersList,
  'admin-order-get': handleAdminOrderGet,
  'admin-order-set-status': handleAdminOrderSetStatus,
};

export function getRouteFromRequest(req: Request, prefix = '/admin-api'): string | null {
  const url = new URL(req.url);
  const pathname = url.pathname || '/';
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  const route = rest.replace(/^\/+/, '').split('/')[0] || '';
  return route ? route : null;
}
