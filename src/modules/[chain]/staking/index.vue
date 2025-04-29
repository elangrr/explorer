<script lang="ts" setup>
import {
    useBaseStore,
    useBlockchain,
    useFormatter,
    useMintStore,
    useStakingStore,
    useTxDialog,
} from '@/stores';
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import type { Key, SlashingParam, Validator } from '@/types';
import { formatSeconds } from '@/libs/utils';
import { diff } from 'semver';

// Store instances
const staking = useStakingStore();
const base = useBaseStore();
const format = useFormatter();
const dialog = useTxDialog();
const chainStore = useBlockchain();
const mintStore = useMintStore();

// State management
const cache = JSON.parse(localStorage.getItem('avatars') || '{}');
const avatars = ref(cache || {});
const latest = ref({} as Record<string, number>);
const yesterday = ref({} as Record<string, number>);
const tab = ref('active');
const unbondList = ref([] as Validator[]);
const slashing = ref({} as SlashingParam);
const loaded = ref(false);
const isLoading = ref(false);
const error = ref<string | null>(null);

// Featured validators configuration
const featuredKeybaseIds = ref<string[]>(['58527185D1DD91F8']); // Hardcoded keybase ID
const isFeaturedValidator = ref(true);

// Load featured validators from localStorage
onMounted(() => {
  // We're not using localStorage anymore, just hardcoded values
  // This ensures the validator is always featured
  
  // Check if current user's keybase ID is in the list
  const userKeybaseId = '58527185D1DD91F8'; // Hardcoded user keybase ID
  isFeaturedValidator.value = featuredKeybaseIds.value.includes(userKeybaseId);
});

// Add a validator to featured list - disabled
function addFeaturedValidator(keybaseId: string) {
  // Function disabled - no changes allowed
  console.log('Adding featured validators is disabled');
}

// Remove a validator from featured list - disabled
function removeFeaturedValidator(keybaseId: string) {
  // Function disabled - no changes allowed
  console.log('Removing featured validators is disabled');
}

// Set user's keybase ID - disabled
function setUserKeybaseId(keybaseId: string) {
  // Function disabled - no changes allowed
  console.log('Setting user keybase ID is disabled');
}

// Computed properties
const changes = computed(() => {
    const changes = {} as Record<string, number>;
    Object.keys(latest.value).forEach((k) => {
        const l = latest.value[k] || 0;
        const y = yesterday.value[k] || 0;
        changes[k] = l - y;
    });
    return changes;
});

// Check if a validator is featured by keybase ID
function isFeaturedByKeybase(validator: Validator): boolean {
  const identity = validator.description?.identity;
  return identity ? featuredKeybaseIds.value.includes(identity) : false;
}

const list = computed(() => {
    let validators = [];
    
    if (tab.value === 'active') {
        // First, separate featured validators
        const featuredValidators = staking.validators
            .filter(x => isFeaturedByKeybase(x))
            .map((x, i) => ({
                v: x,
                rank: calculateRank(i),
                logo: logo(x.description.identity),
                isFeatured: true
            }));
            
        // Then get regular validators
        const regularValidators = staking.validators
            .filter(x => !isFeaturedByKeybase(x))
            .map((x, i) => ({
                v: x,
                rank: calculateRank(i),
                logo: logo(x.description.identity),
                isFeatured: false
            }));
            
        // Combine featured first, then regular
        validators = [...featuredValidators, ...regularValidators];
    } else if (tab.value === 'featured') {
        const endpoint = chainStore.current?.endpoints?.rest?.map(x => x.provider);
        if (endpoint) {
            endpoint.push('ping');
            
            // First, get featured validators by keybase
            const keybaseFeatured = staking.validators
                .filter(x => isFeaturedByKeybase(x))
                .map((x, i) => ({
                    v: x,
                    rank: 'primary',
                    logo: logo(x.description.identity),
                    isFeatured: true
                }));
                
            // Then get featured validators by endpoint
            const endpointFeatured = staking.validators
                .filter(x => !isFeaturedByKeybase(x) && isFeatured(endpoint, x.description))
                .map((x, i) => ({
                    v: x,
                    rank: 'primary',
                    logo: logo(x.description.identity),
                    isFeatured: false
                }));
                
            validators = [...keybaseFeatured, ...endpointFeatured];
        }
    } else {
        // For inactive validators
        const featuredInactive = unbondList.value
            .filter(x => isFeaturedByKeybase(x))
            .map((x, i) => ({
                v: x,
                rank: 'primary',
                logo: logo(x.description.identity),
                isFeatured: true
            }));
            
        const regularInactive = unbondList.value
            .filter(x => !isFeaturedByKeybase(x))
            .map((x, i) => ({
                v: x,
                rank: 'primary',
                logo: logo(x.description.identity),
                isFeatured: false
            }));
            
        validators = [...featuredInactive, ...regularInactive];
    }
    
    return validators;
});

// Methods
const calculateRank = function (position: number) {
    let sum = 0;
    for (let i = 0; i < position; i++) {
        sum += Number(staking.validators[i]?.delegator_shares);
    }
    const percent = sum / staking.totalPower;

    switch (true) {
        case tab.value === 'active' && percent < 0.33:
            return 'error';
        case tab.value === 'active' && percent < 0.67:
            return 'warning';
        default:
            return 'primary';
    }
};

function isFeatured(endpoints: string[], who?: { website?: string; moniker: string }) {
    if (!endpoints || !who) return false;
    return endpoints.findIndex(
        x => (who.website && who.website?.substring(0, who.website?.lastIndexOf('.')).endsWith(x)) || 
             who?.moniker?.toLowerCase().search(x.toLowerCase()) > -1
    ) > -1;
}

const change24 = (entry: { consensus_pubkey: Key; tokens: string }) => {
    const txt = entry.consensus_pubkey.key;
    const latestValue = latest.value[txt];
    if (!latestValue) return 0;

    const displayTokens = format.tokenAmountNumber({
        amount: parseInt(entry.tokens, 10).toString(),
        denom: staking.params.bond_denom,
    });
    const coefficient = displayTokens / latestValue;
    return changes.value[txt] * coefficient;
};

const change24Text = (entry: { consensus_pubkey: Key; tokens: string }) => {
    if (!entry) return '';
    const v = change24(entry);
    return v && v !== 0 ? format.showChanges(v) : '';
};

const change24Color = (entry: { consensus_pubkey: Key; tokens: string }) => {
    if (!entry) return '';
    const v = change24(entry);
    if (v > 0) return 'text-success';
    if (v < 0) return 'text-error';
    return '';
};

// Avatar handling
const fetchAvatar = async (identity: string) => {
    try {
        const d = await staking.keybase(identity);
        if (Array.isArray(d.them) && d.them.length > 0) {
            const uri = String(d.them[0]?.pictures?.primary?.url).replace(
                'https://s3.amazonaws.com/keybase_processed_uploads/',
                ''
            );
            avatars.value[identity] = uri;
            return true;
        }
        throw new Error(`Failed to fetch avatar for ${identity}`);
    } catch (error) {
        console.error(`Error fetching avatar for ${identity}:`, error);
        return false;
    }
};

const loadAvatar = async (identity: string) => {
    const success = await fetchAvatar(identity);
    if (success) {
        localStorage.setItem('avatars', JSON.stringify(avatars.value));
    }
};

const loadAvatars = async () => {
    try {
        isLoading.value = true;
        const promises = staking.validators.map((validator) => {
            const identity = validator.description?.identity;
            if (identity && !avatars.value[identity]) {
                return fetchAvatar(identity);
            }
            return Promise.resolve(false);
        });

        await Promise.all(promises);
        localStorage.setItem('avatars', JSON.stringify(avatars.value));
    } catch (error) {
        console.error('Error loading avatars:', error);
    } finally {
        isLoading.value = false;
    }
};

const logo = (identity?: string) => {
    if (!identity || !avatars.value[identity]) return '';
    const url = avatars.value[identity] || '';
    return url.startsWith('http')
        ? url
        : `https://s3.amazonaws.com/keybase_processed_uploads/${url}`;
};

// Data fetching
async function fetchChange(blockWindow: number = 14400) {
    try {
        isLoading.value = true;
        let page = 0;
        let height = Number(base.latest?.block?.header?.height || 0);
        
        if (height > blockWindow) {
            height -= blockWindow;
        } else {
            height = 1;
        }

        // Fetch voting power from 24h ago
        while (page < staking.validators.length && height > 0) {
            const x = await base.fetchValidatorByHeight(height, page);
            x.validators.forEach((v) => {
                yesterday.value[v.pub_key.key] = Number(v.voting_power);
            });
            page += 100;
        }

        page = 0;
        // Fetch current voting power
        while (page < staking.validators.length) {
            const x = await base.fetchLatestValidators(page);
            x.validators.forEach((v) => {
                latest.value[v.pub_key.key] = Number(v.voting_power);
            });
            page += 100;
        }
    } catch (error) {
        console.error('Error fetching changes:', error);
        error.value = 'Failed to fetch validator changes';
    } finally {
        isLoading.value = false;
    }
}

// Lifecycle hooks
onMounted(async () => {
    try {
        isLoading.value = true;
        const [unbondingRes, inactiveRes, slashingRes] = await Promise.all([
            staking.fetchUnbondingValdiators(),
            staking.fetchInacitveValdiators(),
            chainStore.rpc.getSlashingParams()
        ]);

        unbondList.value = [...unbondingRes, ...inactiveRes];
        slashing.value = slashingRes.params;
    } catch (error) {
        console.error('Error initializing staking module:', error);
        error.value = 'Failed to initialize staking module';
    } finally {
        isLoading.value = false;
    }
});

// Watch for block updates
watch(() => base.recents, (newRecents) => {
    if (newRecents.length >= 2 && !loaded.value) {
        loaded.value = true;
        const diff_time = Date.parse(newRecents[1].block.header.time) - Date.parse(newRecents[0].block.header.time);
        const diff_height = Number(newRecents[1].block.header.height) - Number(newRecents[0].block.header.height);
        const block_window = Number(Number(86400 * 1000 * diff_height / diff_time).toFixed(0));
        fetchChange(block_window);
    }
}, { deep: true });

// Initial avatar loading
loadAvatars();
</script>

<template>
    <div>
        <!-- Stats Cards -->
        <div class="bg-base-100 rounded-lg grid sm:grid-cols-1 md:grid-cols-4 p-4 gap-4">
            <div class="flex items-center p-4 bg-base-200 rounded-lg transition-all hover:scale-105">
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center mr-4">
                    <Icon class="text-success" icon="mdi:trending-up" size="32" />
                    <div class="absolute inset-0 opacity-20 bg-success"></div>
                </div>
                <div>
                    <div class="font-bold text-lg">{{ format.percent(mintStore.inflation) }}</div>
                    <div class="text-sm text-gray-500">{{ $t('staking.inflation') }}</div>
                </div>
            </div>

            <div class="flex items-center p-4 bg-base-200 rounded-lg transition-all hover:scale-105">
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center mr-4">
                    <Icon class="text-primary" icon="mdi:lock-open-outline" size="32" />
                    <div class="absolute inset-0 opacity-20 bg-primary"></div>
                </div>
                <div>
                    <div class="font-bold text-lg">{{ formatSeconds(staking.params?.unbonding_time) }}</div>
                    <div class="text-sm text-gray-500">{{ $t('staking.unbonding_time') }}</div>
                </div>
            </div>

            <div class="flex items-center p-4 bg-base-200 rounded-lg transition-all hover:scale-105">
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center mr-4">
                    <Icon class="text-error" icon="mdi:alert-octagon-outline" size="32" />
                    <div class="absolute inset-0 opacity-20 bg-error"></div>
                </div>
                <div>
                    <div class="font-bold text-lg">{{ format.percent(slashing.slash_fraction_double_sign) }}</div>
                    <div class="text-sm text-gray-500">{{ $t('staking.double_sign_slashing') }}</div>
                </div>
            </div>

            <div class="flex items-center p-4 bg-base-200 rounded-lg transition-all hover:scale-105">
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center mr-4">
                    <Icon class="text-error" icon="mdi:pause" size="32" />
                    <div class="absolute inset-0 opacity-20 bg-error"></div>
                </div>
                <div>
                    <div class="font-bold text-lg">{{ format.percent(slashing.slash_fraction_downtime) }}</div>
                    <div class="text-sm text-gray-500">{{ $t('staking.downtime_slashing') }}</div>
                </div>
            </div>
        </div>

        <!-- Featured Validators Section -->
        <div v-if="featuredKeybaseIds.length > 0" class="mt-6 bg-base-100 rounded-lg shadow-lg overflow-hidden">
            <div class="p-4 bg-primary bg-opacity-10 border-b border-primary">
                <h3 class="text-lg font-bold text-primary flex items-center">
                    <Icon icon="mdi:star" class="mr-2" />
                    Featured Validators
                </h3>
            </div>
            <div class="p-4">
                <div class="overflow-x-auto">
                    <table class="table w-full">
                        <thead class="bg-base-200">
                            <tr>
                                <th class="w-16">{{ $t('staking.rank') }}</th>
                                <th>{{ $t('staking.validator') }}</th>
                                <th class="text-right">{{ $t('staking.voting_power') }}</th>
                                <th class="text-right">{{ $t('staking.24h_changes') }}</th>
                                <th class="text-right">{{ $t('staking.commission') }}</th>
                                <th class="text-center">{{ $t('staking.actions') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="({v, rank, logo}, i) in list.filter(item => item.isFeatured)"
                                :key="v.operator_address"
                                class="hover:bg-base-200 transition-colors bg-primary bg-opacity-5"
                            >
                                <td>
                                    <div
                                        class="text-xs px-3 py-1 rounded-full w-fit"
                                        :class="`bg-${rank} bg-opacity-10 text-${rank}`"
                                    >
                                        {{ i + 1 }}
                                    </div>
                                </td>
                                <td>
                                    <div class="flex items-center space-x-4">
                                        <div class="avatar">
                                            <div class="w-10 h-10 rounded-full">
                                                <img
                                                    v-if="logo"
                                                    :src="logo"
                                                    class="object-cover"
                                                    @error="
                                                        (e) => {
                                                            const identity = v.description?.identity;
                                                            if (identity) loadAvatar(identity);
                                                        }
                                                    "
                                                />
                                                <Icon
                                                    v-else
                                                    class="w-full h-full text-gray-400"
                                                    icon="mdi:account-circle"
                                                />
                                            </div>
                                        </div>
                                        <div class="flex flex-col">
                                            <RouterLink
                                                :to="{
                                                    name: 'chain-staking-validator',
                                                    params: { validator: v.operator_address },
                                                }"
                                                class="font-medium text-primary hover:text-primary-focus"
                                            >
                                                {{ v.description?.moniker }}
                                                <span class="badge badge-primary badge-sm ml-2">Featured</span>
                                            </RouterLink>
                                            <span class="text-sm text-gray-500">
                                                {{ v.description?.website || v.description?.identity || '-' }}
                                            </span>
                                        </div>
                                    </div>
                                </td>
                                <td class="text-right">
                                    <div class="flex flex-col">
                                        <span class="font-medium">
                                            {{
                                                format.formatToken(
                                                    {
                                                        amount: parseInt(v.tokens).toString(),
                                                        denom: staking.params.bond_denom,
                                                    },
                                                    true,
                                                    '0,0'
                                                )
                                            }}
                                        </span>
                                        <span class="text-sm text-gray-500">
                                            {{
                                                format.calculatePercent(
                                                    v.delegator_shares,
                                                    staking.totalPower
                                                )
                                            }}
                                        </span>
                                    </div>
                                </td>
                                <td
                                    class="text-right"
                                    :class="change24Color(v)"
                                >
                                    {{ change24Text(v) }}
                                </td>
                                <td class="text-right">
                                    {{
                                        format.formatCommissionRate(
                                            v.commission?.commission_rates?.rate
                                        )
                                    }}
                                </td>
                                <td class="text-center">
                                    <div
                                        v-if="v.jailed"
                                        class="badge badge-error gap-2"
                                    >
                                        {{ $t('staking.jailed') }}
                                    </div>
                                    <button
                                        v-else
                                        class="btn btn-sm btn-primary"
                                        @click="
                                            dialog.open('delegate', {
                                                validator_address: v.operator_address,
                                            })
                                        "
                                    >
                                        {{ $t('account.btn_delegate') }}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Validator List -->
        <div class="mt-6">
            <div class="flex items-center justify-between py-4">
                <div class="tabs tabs-boxed bg-transparent">
                    <a
                        class="tab text-gray-400 transition-all"
                        :class="{ 'tab-active bg-primary text-white': tab === 'featured' }"
                        @click="tab = 'featured'"
                    >
                        {{ $t('staking.popular') }}
                    </a>
                    <a
                        class="tab text-gray-400 transition-all"
                        :class="{ 'tab-active bg-primary text-white': tab === 'active' }"
                        @click="tab = 'active'"
                    >
                        {{ $t('staking.active') }}
                    </a>
                    <a
                        class="tab text-gray-400 transition-all"
                        :class="{ 'tab-active bg-primary text-white': tab === 'inactive' }"
                        @click="tab = 'inactive'"
                    >
                        {{ $t('staking.inactive') }}
                    </a>
                </div>

                <div class="text-lg font-semibold bg-base-200 px-4 py-2 rounded-lg">
                    {{ list.length }}/{{ staking.params.max_validators }}
                </div>
            </div>

            <!-- Loading State -->
            <div v-if="isLoading" class="flex justify-center items-center py-12">
                <div class="loading loading-spinner loading-lg text-primary"></div>
            </div>

            <!-- Error State -->
            <div v-else-if="error" class="alert alert-error">
                <Icon icon="mdi:alert-circle" class="text-xl" />
                <span>{{ error }}</span>
            </div>

            <!-- Validator Table -->
            <div v-else class="bg-base-100 rounded-lg shadow-lg overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="table w-full">
                        <thead class="bg-base-200">
                            <tr>
                                <th class="w-16">{{ $t('staking.rank') }}</th>
                                <th>{{ $t('staking.validator') }}</th>
                                <th class="text-right">{{ $t('staking.voting_power') }}</th>
                                <th class="text-right">{{ $t('staking.24h_changes') }}</th>
                                <th class="text-right">{{ $t('staking.commission') }}</th>
                                <th class="text-center">{{ $t('staking.actions') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="({v, rank, logo, isFeatured}, i) in list.filter(item => !item.isFeatured)"
                                :key="v.operator_address"
                                class="hover:bg-base-200 transition-colors"
                            >
                                <td>
                                    <div
                                        class="text-xs px-3 py-1 rounded-full w-fit"
                                        :class="`bg-${rank} bg-opacity-10 text-${rank}`"
                                    >
                                        {{ i + 1 }}
                                    </div>
                                </td>
                                <td>
                                    <div class="flex items-center space-x-4">
                                        <div class="avatar">
                                            <div class="w-10 h-10 rounded-full">
                                                <img
                                                    v-if="logo"
                                                    :src="logo"
                                                    class="object-cover"
                                                    @error="
                                                        (e) => {
                                                            const identity = v.description?.identity;
                                                            if (identity) loadAvatar(identity);
                                                        }
                                                    "
                                                />
                                                <Icon
                                                    v-else
                                                    class="w-full h-full text-gray-400"
                                                    icon="mdi:account-circle"
                                                />
                                            </div>
                                        </div>
                                        <div class="flex flex-col">
                                            <RouterLink
                                                :to="{
                                                    name: 'chain-staking-validator',
                                                    params: { validator: v.operator_address },
                                                }"
                                                class="font-medium text-primary hover:text-primary-focus"
                                            >
                                                {{ v.description?.moniker }}
                                            </RouterLink>
                                            <span class="text-sm text-gray-500">
                                                {{ v.description?.website || v.description?.identity || '-' }}
                                            </span>
                                        </div>
                                    </div>
                                </td>
                                <td class="text-right">
                                    <div class="flex flex-col">
                                        <span class="font-medium">
                                            {{
                                                format.formatToken(
                                                    {
                                                        amount: parseInt(v.tokens).toString(),
                                                        denom: staking.params.bond_denom,
                                                    },
                                                    true,
                                                    '0,0'
                                                )
                                            }}
                                        </span>
                                        <span class="text-sm text-gray-500">
                                            {{
                                                format.calculatePercent(
                                                    v.delegator_shares,
                                                    staking.totalPower
                                                )
                                            }}
                                        </span>
                                    </div>
                                </td>
                                <td
                                    class="text-right"
                                    :class="change24Color(v)"
                                >
                                    {{ change24Text(v) }}
                                </td>
                                <td class="text-right">
                                    {{
                                        format.formatCommissionRate(
                                            v.commission?.commission_rates?.rate
                                        )
                                    }}
                                </td>
                                <td class="text-center">
                                    <div
                                        v-if="v.jailed"
                                        class="badge badge-error gap-2"
                                    >
                                        {{ $t('staking.jailed') }}
                                    </div>
                                    <button
                                        v-else
                                        class="btn btn-sm btn-primary"
                                        @click="
                                            dialog.open('delegate', {
                                                validator_address: v.operator_address,
                                            })
                                        "
                                    >
                                        {{ $t('account.btn_delegate') }}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Legend -->
                <div class="p-4 bg-base-200">
                    <div class="flex items-center space-x-4">
                        <div class="flex items-center space-x-2">
                            <div class="w-3 h-3 rounded-full bg-error"></div>
                            <span class="text-sm">{{ $t('staking.top') }} 33%</span>
                        </div>
                        <div class="flex items-center space-x-2">
                            <div class="w-3 h-3 rounded-full bg-warning"></div>
                            <span class="text-sm">{{ $t('staking.top') }} 67%</span>
                        </div>
                        <div class="text-sm text-gray-500 hidden md:block">
                            {{ $t('staking.description') }}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<route>
{
    meta: {
        i18n: 'staking',
        order: 3
    }
}
</route>

<style scoped>
.table :where(th, td) {
    padding: 1rem;
    background: transparent;
}

.table tbody tr {
    transition: all 0.2s ease-in-out;
}

.table tbody tr:hover {
    transform: translateY(-1px);
}

.avatar img {
    transition: all 0.2s ease-in-out;
}

.avatar img:hover {
    transform: scale(1.1);
}

.tab {
    transition: all 0.2s ease-in-out;
}

.tab:hover {
    transform: translateY(-1px);
}

.btn {
    transition: all 0.2s ease-in-out;
}

.btn:hover {
    transform: translateY(-1px);
}
</style>
