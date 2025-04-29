<script setup lang="ts">
import { parseCoins } from '@cosmjs/stargate';
import {
  useBlockchain,
  useFormatter,
  useMintStore,
  useStakingStore,
  useTxDialog,
} from '@/stores';
import { onMounted, computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import CommissionRate from '@/components/ValidatorCommissionRate.vue';
import {
  consensusPubkeyToHexAddress,
  operatorAddressToAccount,
  pubKeyToValcons,
} from '@/libs';
import { PageRequest, type Coin, type Delegation, type PaginatedDelegations, type PaginatedTxs, type Validator } from '@/types';
import PaginationBar from '@/components/PaginationBar.vue';
import { fromBase64, toBase64 } from '@cosmjs/encoding';
import { stringToUint8Array, uint8ArrayToString } from '@/libs/utils';

const props = defineProps(['validator', 'chain']);

const staking = useStakingStore();
const blockchain = useBlockchain();
const format = useFormatter();
const dialog = useTxDialog();
const page = new PageRequest();

const validator: string = props.validator;

const v = ref({} as Validator);
const cache = JSON.parse(localStorage.getItem('avatars') || '{}');
const avatars = ref(cache || {});
const identity = ref('');
const rewards = ref([] as Coin[] | undefined);
const commission = ref([] as Coin[] | undefined);
const delegations = ref({} as PaginatedDelegations)
const addresses = ref(
  {} as {
    account: string;
    operAddress: string;
    hex: string;
    valCons: string;
  }
);
const selfBonded = ref({} as Delegation);

addresses.value.account = operatorAddressToAccount(validator);
// load self bond
staking
  .fetchValidatorDelegation(validator, addresses.value.account)
  .then((x) => {
    if (x) {
      selfBonded.value = x.delegation_response;
    }
  });

const txs = ref({} as PaginatedTxs);

blockchain.rpc.getTxsBySender(addresses.value.account).then((x) => {
  txs.value = x;
});

const apr = computed(() => {
  const rate = v.value.commission?.commission_rates.rate || 0;
  const inflation = useMintStore().inflation;
  if (Number(inflation)) {
    return format.percent((1 - Number(rate)) * Number(inflation));
  }
  return '-';
});

const selfRate = computed(() => {
  if (selfBonded.value.balance?.amount) {
    return format.calculatePercent(
      selfBonded.value.balance.amount,
      v.value.tokens
    );
  }
  return '-';
});

const logo = (identity?: string) => {
  if (!identity) return '';
  const url = avatars.value[identity] || '';
  return url.startsWith('http')
    ? url
    : `https://s3.amazonaws.com/keybase_processed_uploads/${url}`;
};

const fetchAvatar = (identity: string) => {
  // fetch avatar from keybase
  return new Promise<void>((resolve) => {
    staking
      .keybase(identity)
      .then((d) => {
        if (Array.isArray(d.them) && d.them.length > 0) {
          const uri = String(d.them[0]?.pictures?.primary?.url).replace(
            'https://s3.amazonaws.com/keybase_processed_uploads/',
            ''
          );

          avatars.value[identity] = uri;
          resolve();
        } else throw new Error(`failed to fetch avatar for ${identity}.`);
      })
      .catch((error) => {
        // console.error(error); // uncomment this if you want the user to see if the avatar failed to load.
        resolve();
      });
  });
};

const loadAvatar = (identity: string) => {
  // fetches avatar from keybase and stores it in localStorage
  fetchAvatar(identity).then(() => {
    localStorage.setItem('avatars', JSON.stringify(avatars.value));
  });
};

onMounted(() => {
  if (validator) {
    staking.fetchValidator(validator).then((res) => {
      v.value = res.validator;
      identity.value = res.validator?.description?.identity || '';
      if (identity.value && !avatars.value[identity.value]) loadAvatar(identity.value);

      addresses.value.hex = consensusPubkeyToHexAddress(
        v.value.consensus_pubkey
      );
      addresses.value.valCons = pubKeyToValcons(
        v.value.consensus_pubkey,
        blockchain.current?.bech32ConsensusPrefix || "",
      );
    });
    blockchain.rpc
      .getDistributionValidatorOutstandingRewards(validator)
      .then((res) => {
        rewards.value = res.rewards?.rewards?.sort(
          (a, b) => Number(b.amount) - Number(a.amount)
        );
        res.rewards?.rewards?.forEach((x) => {
          if (x.denom.startsWith('ibc/')) {
            format.fetchDenomTrace(x.denom);
          }
        });
      });
    blockchain.rpc.getDistributionValidatorCommission(validator).then((res) => {
      commission.value = res.commission?.commission?.sort(
        (a, b) => Number(b.amount) - Number(a.amount)
      );
      res.commission?.commission?.forEach((x) => {
        if (x.denom.startsWith('ibc/')) {
          format.fetchDenomTrace(x.denom);
        }
      });
    });

    // Disable delegations due to its bad performance
    // Comment out the following code if you want to enable it
    // pageload(1)

  }
});
let showCopyToast = ref(0);
const copyWebsite = async (url: string) => {
  if (!url) {
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showCopyToast.value = 1;
    setTimeout(() => {
      showCopyToast.value = 0;
    }, 1000);
  } catch (err) {
    showCopyToast.value = 2;
    setTimeout(() => {
      showCopyToast.value = 0;
    }, 1000);
  }
};
const tipMsg = computed(() => {
  return showCopyToast.value === 2
    ? { class: 'error', msg: 'Copy Error!' }
    : { class: 'success', msg: 'Copy Success!' };
});

function pageload(p: number) {
  page.setPage(p);
  page.limit = 10;

  blockchain.rpc.getStakingValidatorsDelegations(validator, page).then(res => {
      delegations.value = res
  }) 
}

const events = ref({} as PaginatedTxs)

enum EventType {
  Delegate = 'delegate',
  Unbond = 'unbond',
}

const selectedEventType = ref(EventType.Delegate)

function loadPowerEvents(p: number, type: EventType) {
  selectedEventType.value = type
  page.setPage(p);
  page.setPageSize(5);
  blockchain.rpc.getTxs("?order_by=2&events={type}.validator='{validator}'", { type: selectedEventType.value, validator }, page).then(res => {
    events.value = res
  })
}

function pagePowerEvents(page: number) {
    loadPowerEvents(page, selectedEventType.value)
}

pagePowerEvents(1)

function mapEvents(events: {type: string, attributes: {key: string, value: string}[]}[]) {
  const attributes = events
    .filter(x => x.type === selectedEventType.value)
    .filter(x => x.attributes.findIndex(attr => attr.value === validator || attr.value === toBase64(stringToUint8Array(validator))) > -1)
    .map(x => {
      // check if attributes need to decode
      const output = {} as {[key: string]: string }

      if (x.attributes.findIndex(a => a.key === `amount`) > -1) {
        x.attributes.forEach(attr => {
          output[attr.key] = attr.value
        })
      } else {
        x.attributes.forEach(attr => {
          output[uint8ArrayToString(fromBase64(attr.key))] = uint8ArrayToString(fromBase64(attr.value))
        })
      };

      return output;
    });

  const coinsAsString = attributes.map((x: any) => x.amount).join(',');
  const coins = parseCoins(coinsAsString);

  return coins.map(coin => format.formatToken(coin)).join(', ');
}

function mapDelegators(messages: any[]) {
  if(!messages) return []
  return Array.from(new Set(messages.map(x => x.delegator_address || x.grantee)))
}

</script>
<template>
  <div class="space-y-6">
    <!-- Validator Profile Card -->
    <div class="bg-base-100 rounded-xl shadow-lg border border-indigo-500/20 overflow-hidden">
      <div class="p-6">
        <div class="flex flex-col lg:flex-row gap-8">
          <!-- Left Column: Profile Info -->
          <div class="flex-1">
            <div class="flex items-start gap-6">
              <div class="avatar relative w-28 h-28 rounded-xl overflow-hidden bg-base-200">
                <div class="w-full h-full rounded-xl absolute opacity-10"></div>
                <div class="w-full h-full rounded-xl">
                  <img
                    v-if="identity && avatars[identity] !== 'undefined'"
                    v-lazy="logo(identity)"
                    class="object-cover w-full h-full"
                    @error="loadAvatar(identity)"
                  />
                  <Icon
                    v-else
                    class="text-8xl text-base-content/20"
                    :icon="`mdi-help-circle-outline`"
                  />
                </div>
              </div>
              <div class="flex-1">
                <div class="flex items-start justify-between">
                  <div>
                    <h2 class="text-2xl font-bold mb-2">{{ v.description?.moniker }}</h2>
                    <div class="text-base-content/70 mb-4">
                      {{ v.description?.identity || '-' }}
                    </div>
                    <p class="text-base mb-4 text-base-content/80">{{ v.description?.details }}</p>
                  </div>
                  <button
                    class="btn btn-primary btn-lg gap-2 hover:scale-105 transition-transform"
                    @click="dialog.open('delegate', { validator_address: v.operator_address })"
                  >
                    <Icon icon="mdi-hand-coin" class="text-xl" />
                    {{ $t('account.btn_delegate') }}
                  </button>
                </div>
              </div>
            </div>

            <!-- About Section -->
            <div class="mt-8 space-y-6">
              <div>
                <h3 class="text-lg font-semibold mb-4">{{ $t('staking.about_us') }}</h3>
                <div class="space-y-3">
                  <div class="flex items-center gap-3">
                    <Icon icon="mdi-web" class="text-xl text-primary" />
                    <span class="font-medium">{{ $t('staking.website') }}:</span>
                    <a
                      :href="v?.description?.website || '#'"
                      :class="v?.description?.website ? 'text-primary hover:underline' : 'text-base-content/50'"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ v.description?.website || '-' }}
                    </a>
                  </div>
                  <div class="flex items-center gap-3">
                    <Icon icon="mdi-email-outline" class="text-xl text-primary" />
                    <span class="font-medium">{{ $t('staking.contact') }}:</span>
                    <a
                      v-if="v.description?.security_contact"
                      :href="'mailto:' + v.description.security_contact"
                      class="text-primary hover:underline"
                    >
                      {{ v.description?.security_contact || '-' }}
                    </a>
                  </div>
                </div>
              </div>

              <!-- Validator Status -->
              <div>
                <h3 class="text-lg font-semibold mb-4">{{ $t('staking.validator_status') }}</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
                    <Icon icon="mdi-shield-account-outline" class="text-xl text-primary" />
                    <div>
                      <span class="font-medium">{{ $t('staking.status') }}:</span>
                      <span class="ml-2" :class="{
                        'text-success': v.status === 'BOND_STATUS_BONDED',
                        'text-warning': v.status === 'BOND_STATUS_UNBONDING',
                        'text-error': v.status === 'BOND_STATUS_UNBONDED'
                      }">
                        {{ String(v.status).replace('BOND_STATUS_', '') }}
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
                    <Icon icon="mdi-shield-alert-outline" class="text-xl text-primary" />
                    <div>
                      <span class="font-medium">{{ $t('staking.jailed') }}:</span>
                      <span class="ml-2" :class="v.jailed ? 'text-error' : 'text-success'">
                        {{ v.jailed ? 'Yes' : 'No' }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Liquid Staking -->
              <div>
                <h3 class="text-lg font-semibold mb-4">{{ $t('staking.liquid_staking') }}</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
                    <Icon icon="mdi-lock" class="text-xl text-primary" />
                    <div>
                      <span class="font-medium">{{ $t('staking.validator_bond_share') }}:</span>
                      <span class="ml-2">
                        {{ format.formatToken({amount: v.validator_bond_shares, denom: staking.params.bond_denom}, false) }}
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
                    <Icon icon="mdi-waves-arrow-right" class="text-xl text-primary" />
                    <div>
                      <span class="font-medium">{{ $t('staking.liquid_staking_shares') }}:</span>
                      <span class="ml-2">
                        {{ format.formatToken({amount: v.liquid_shares, denom: staking.params.bond_denom}, false) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Stats -->
          <div class="flex-1">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Total Bonded -->
              <div class="stat bg-base-200 rounded-lg">
                <div class="stat-figure text-primary">
                  <Icon icon="mdi-coin" class="text-3xl" />
                </div>
                <div class="stat-title">{{ $t('staking.total_bonded') }}</div>
                <div class="stat-value text-primary">
                  {{ format.formatToken2({ amount: v.tokens, denom: staking.params.bond_denom }) }}
                </div>
              </div>

              <!-- Self Bonded -->
              <div class="stat bg-base-200 rounded-lg">
                <div class="stat-figure text-primary">
                  <Icon icon="mdi-percent" class="text-3xl" />
                </div>
                <div class="stat-title">{{ $t('staking.self_bonded') }}</div>
                <div class="stat-value text-primary">
                  {{ format.formatToken(selfBonded.balance) }}
                </div>
                <div class="stat-desc">{{ selfRate }}</div>
              </div>

              <!-- Min Self Delegation -->
              <div class="stat bg-base-200 rounded-lg">
                <div class="stat-figure text-primary">
                  <Icon icon="mdi-account-tie" class="text-3xl" />
                </div>
                <div class="stat-title">{{ $t('staking.min_self') }}</div>
                <div class="stat-value text-primary">
                  {{ v.min_self_delegation }} {{ staking.params.bond_denom }}
                </div>
              </div>

              <!-- Annual Profit -->
              <div class="stat bg-base-200 rounded-lg">
                <div class="stat-figure text-primary">
                  <Icon icon="mdi-finance" class="text-3xl" />
                </div>
                <div class="stat-title">{{ $t('staking.annual_profit') }}</div>
                <div class="stat-value text-primary">{{ apr }}</div>
              </div>

              <!-- Unbonding Height -->
              <div class="stat bg-base-200 rounded-lg">
                <div class="stat-figure text-primary">
                  <Icon icon="mdi:arrow-down-bold-circle-outline" class="text-3xl" />
                </div>
                <div class="stat-title">{{ $t('staking.unbonding_height') }}</div>
                <div class="stat-value text-primary">{{ v.unbonding_height }}</div>
              </div>

              <!-- Unbonding Time -->
              <div class="stat bg-base-200 rounded-lg">
                <div class="stat-figure text-primary">
                  <Icon icon="mdi-clock" class="text-3xl" />
                </div>
                <div class="stat-title">{{ $t('staking.unbonding_time') }}</div>
                <div class="stat-value text-primary">
                  <span v-if="v.unbonding_time && !v.unbonding_time.startsWith('1970')">
                    {{ format.toDay(v.unbonding_time, 'from') }}
                  </span>
                  <span v-else>-</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="px-6 py-4 bg-base-200/50 border-t">
        <!-- Removing the description from here since we moved it up -->
      </div>
    </div>

    <!-- Commission & Rewards Section -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- Commission Rate -->
      <div class="bg-base-100 rounded-xl shadow-lg p-6">
        <CommissionRate :commission="v.commission" />
      </div>

      <!-- Commissions & Rewards -->
      <div class="bg-base-100 rounded-xl shadow-lg p-6">
        <h3 class="text-xl font-semibold mb-6">{{ $t('staking.commissions_&_rewards') }}</h3>
        <div class="space-y-6">
          <div>
            <h4 class="text-lg font-medium mb-3">{{ $t('staking.commissions') }}</h4>
            <div class="flex flex-wrap gap-2">
              <div
                v-for="(i, k) in commission"
                :key="`commission-${k}`"
                class="badge badge-primary badge-lg"
              >
                {{ format.formatToken2(i) }}
              </div>
            </div>
          </div>
          <div>
            <h4 class="text-lg font-medium mb-3">{{ $t('staking.outstanding') }} {{ $t('account.rewards') }}</h4>
            <div class="flex flex-wrap gap-2">
              <div
                v-for="(i, k) in rewards"
                :key="`reward-${k}`"
                class="badge badge-secondary badge-lg"
              >
                {{ format.formatToken2(i) }}
              </div>
            </div>
          </div>
          <button
            class="btn btn-primary w-full gap-2 hover:scale-105 transition-transform"
            @click="dialog.open('withdraw_commission', { validator_address: v.operator_address })"
          >
            <Icon icon="mdi-cash-multiple" class="text-xl" />
            {{ $t('account.btn_withdraw') }}
          </button>
        </div>
      </div>

      <!-- Addresses -->
      <div class="bg-base-100 rounded-xl shadow-lg p-6">
        <h3 class="text-xl font-semibold mb-6">{{ $t('staking.addresses') }}</h3>
        <div class="space-y-4">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-medium">{{ $t('staking.account_addr') }}</span>
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer text-primary hover:text-primary-focus"
                v-show="addresses.account"
                @click="copyWebsite(addresses.account || '')"
              />
            </div>
            <RouterLink
              class="text-sm text-primary hover:underline block truncate"
              :to="`/${chain}/account/${addresses.account}`"
            >
              {{ addresses.account }}
            </RouterLink>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-medium">{{ $t('staking.operator_addr') }}</span>
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer text-primary hover:text-primary-focus"
                v-show="v.operator_address"
                @click="copyWebsite(v.operator_address || '')"
              />
            </div>
            <div class="text-sm truncate">{{ v.operator_address }}</div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-medium">{{ $t('staking.hex_addr') }}</span>
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer text-primary hover:text-primary-focus"
                v-show="addresses.hex"
                @click="copyWebsite(addresses.hex || '')"
              />
            </div>
            <div class="text-sm truncate">{{ addresses.hex }}</div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-medium">{{ $t('staking.signer_addr') }}</span>
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer text-primary hover:text-primary-focus"
                v-show="addresses.valCons"
                @click="copyWebsite(addresses.valCons || '')"
              />
            </div>
            <div class="text-sm truncate">{{ addresses.valCons }}</div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-medium">{{ $t('staking.consensus_pub_key') }}</span>
              <Icon
                icon="mdi:content-copy"
                class="cursor-pointer text-primary hover:text-primary-focus"
                v-show="v.consensus_pubkey"
                @click="copyWebsite(JSON.stringify(v.consensus_pubkey) || '')"
              />
            </div>
            <div class="text-sm truncate">{{ v.consensus_pubkey }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Delegations Table -->
    <div v-if="delegations.delegation_responses" class="bg-base-100 rounded-xl shadow-lg p-6">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-semibold">{{ $t('account.delegations') }}</h3>
        <span class="text-base-content/70">
          {{ delegations.delegation_responses?.length || 0 }} / {{ delegations.pagination?.total || 0 }}
        </span>
      </div>
      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead>
            <tr>
              <th class="text-left">{{ $t('account.delegator') }}</th>
              <th class="text-left">{{ $t('account.delegation') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="{balance, delegation} in delegations.delegation_responses" class="hover">
              <td class="text-primary">
                <RouterLink :to="`/${chain}/account/${delegation.delegator_address}`" class="hover:underline">
                  {{ delegation.delegator_address }}
                </RouterLink>
              </td>
              <td class="text-primary">{{ format.formatToken(balance) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-4">
        <PaginationBar :total="delegations.pagination?.total" :limit="page.limit" :callback="pageload"/>
      </div>
    </div>

    <!-- Transactions Table -->
    <div class="bg-base-100 rounded-xl shadow-lg p-6">
      <h3 class="text-xl font-semibold mb-6">{{ $t('account.transactions') }}</h3>
      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead>
            <tr>
              <th class="text-left">{{ $t('account.height') }}</th>
              <th class="text-left">{{ $t('account.hash') }}</th>
              <th class="text-left" width="40%">{{ $t('account.messages') }}</th>
              <th class="text-left">{{ $t('account.time') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in txs.tx_responses" class="hover">
              <td class="text-primary">
                <RouterLink :to="`/${props.chain}/block/${item.height}`" class="hover:underline">
                  {{ item.height }}
                </RouterLink>
              </td>
              <td class="text-primary truncate max-w-[200px]">
                <RouterLink :to="`/${props.chain}/tx/${item.txhash}`" class="hover:underline">
                  {{ item.txhash }}
                </RouterLink>
              </td>
              <td>
                <div class="flex items-center gap-2">
                  <span>{{ format.messages(item.tx.body.messages) }}</span>
                  <Icon
                    v-if="item.code === 0"
                    icon="mdi-check"
                    class="text-success"
                  />
                  <Icon v-else icon="mdi-multiply" class="text-error" />
                </div>
              </td>
              <td>{{ format.toDay(item.timestamp, 'from') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Voting Power Events -->
    <div class="bg-base-100 rounded-xl shadow-lg p-6">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-semibold">Voting Power Events</h3>
        <div class="tabs tabs-boxed bg-transparent">
          <a
            class="tab"
            :class="{ 'tab-active': selectedEventType === EventType.Delegate }"
            @click="loadPowerEvents(1, EventType.Delegate)"
          >
            {{ $t('account.btn_delegate') }}
          </a>
          <a
            class="tab"
            :class="{ 'tab-active': selectedEventType === EventType.Unbond }"
            @click="loadPowerEvents(1, EventType.Unbond)"
          >
            {{ $t('account.btn_unbond') }}
          </a>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead>
            <tr>
              <th class="text-left">{{ $t('account.delegator') }}</th>
              <th class="text-left">{{ $t('account.amount') }}</th>
              <th class="text-left">{{ $t('account.height') }} / {{ $t('account.time') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in events.tx_responses" class="hover">
              <td class="text-primary truncate max-w-[250px]">
                <RouterLink 
                  v-for="d in mapDelegators(item.tx?.body?.messages)" 
                  :key="d"
                  :to="`/${props.chain}/account/${d}`"
                  class="hover:underline"
                >
                  {{ d }}
                </RouterLink>
              </td>
              <td>
                <div class="flex items-center gap-2" :class="{
                  'text-success': selectedEventType === EventType.Delegate,
                  'text-error': selectedEventType === EventType.Unbond
                }">
                  <RouterLink :to="`/${props.chain}/tx/${item.txhash}`" class="hover:underline">
                    <span class="mr-2">
                      {{ (selectedEventType === EventType.Delegate ? '+' : '-') }} {{ mapEvents(item.events) }}
                    </span>
                  </RouterLink>
                  <Icon
                    v-if="item.code === 0"
                    icon="mdi-check"
                    class="text-success"
                  />
                  <Icon v-else icon="mdi-multiply" class="text-error" />
                </div>
              </td>
              <td>
                <RouterLink :to="`/${props.chain}/block/${item.height}`" class="text-primary hover:underline">
                  {{ item.height }}
                </RouterLink>
                <div class="text-sm text-base-content/70">
                  {{ format.toDay(item.timestamp, 'from') }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-4">
        <PaginationBar :total="events.pagination?.total" :limit="page.limit" :callback="pagePowerEvents"/>
      </div>
    </div>

    <!-- Copy Toast -->
    <div class="toast toast-end" v-show="showCopyToast">
      <div :class="['alert', showCopyToast === 1 ? 'alert-success' : 'alert-error']">
        <span>{{ tipMsg.msg }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table :where(th, td) {
  padding: 1rem;
  font-size: 0.875rem;
}

.table tbody tr {
  transition: background-color 0.2s;
}

.table tbody tr:hover {
  background-color: hsl(var(--b2));
}

.badge {
  @apply px-3 py-1;
}

.stat {
  @apply p-4;
}

.stat-title {
  @apply text-sm text-base-content/70;
}

.stat-value {
  @apply text-2xl font-bold;
}

.stat-desc {
  @apply text-sm text-base-content/70;
}

.toast {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 100;
}
</style>
