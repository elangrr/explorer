import { defineStore } from 'pinia';
import { get } from '../libs/http';
import type { Chain, Asset } from '@ping-pub/chain-registry-client/dist/types';
import { useBlockchain } from './useBlockchain';

// Enhanced type definitions with better documentation
export enum EndpointType {
  rpc = 'rpc',
  rest = 'rest',
  grpc = 'grpc',
}

export interface Endpoint {
  type?: EndpointType;
  address: string;
  provider: string;
  isActive?: boolean;
  lastChecked?: Date;
}

// Chain config structure of cosmos.directory with improved typing
export interface DirectoryChain {
  assets: Asset[];
  bech32_prefix: string;
  best_apis: {
    rest: Endpoint[];
    rpc: Endpoint[];
  };
  chain_id: string;
  chain_name: string;
  pretty_name: string;
  coingecko_id: string;
  cosmwasm_enabled: boolean;
  decimals: number;
  denom: string;
  display: string;
  explorers?: {
    name?: string;
    kind?: string;
    url?: string;
    tx_page?: string;
    account_page?: string;
  }[];
  height: number;
  image: string;
  name: string;
  network_type: string;
  symbol: string;
  versions?: {
    application_version: string;
    cosmos_sdk_version: string;
    tendermint_version: string;
  };
}

export interface ChainConfig {
  chainName: string;
  prettyName: string;
  bech32Prefix: string;
  bech32ConsensusPrefix: string;
  chainId: string;
  coinType: string;
  assets: Asset[];
  themeColor?: string;
  features?: string[];
  endpoints: {
    rest?: Endpoint[];
    rpc?: Endpoint[];
    grpc?: Endpoint[];
  };
  logo: string;
  versions: {
    application?: string;
    cosmosSdk?: string;
    tendermint?: string;
  };
  exponent: string;
  excludes?: string;
  providerChain?: {
    api: Endpoint[];
  };
  keplrFeatures?: string[];
  keplrPriceStep?: {
    low: number;
    average: number;
    high: number;
  };
}

export interface LocalConfig {
  addr_prefix: string;
  consensus_prefix?: string;
  alias: string;
  api: string[] | Endpoint[];
  provider_chain: {
    api: string[] | Endpoint[];
  };
  assets: {
    base: string;
    coingecko_id: string;
    exponent: string;
    logo: string;
    symbol: string;
  }[];
  chain_name: string;
  coin_type: string;
  logo: string;
  theme_color?: string;
  min_tx_fee: string;
  rpc: string[] | Endpoint[];
  sdk_version: string;
  registry_name?: string;
  features?: string[];
  keplr_price_step?: {
    low: number;
    average: number;
    high: number;
  };
  keplr_features: string[];
}

// Enhanced API converter with better error handling
function apiConverter(api: any[]): Endpoint[] {
  if (!api) return [];
  const array = typeof api === 'string' ? [api] : api;
  return array.map((x) => {
    if (typeof x === 'string') {
      const parts = String(x).split('.');
      return {
        address: x,
        provider: parts.length >= 2 ? parts[parts.length - 2] : x,
        isActive: true,
        lastChecked: new Date(),
      };
    }
    return {
      ...x,
      isActive: true,
      lastChecked: new Date(),
    } as Endpoint;
  });
}

// Improved conversion functions with better error handling
export function fromLocal(lc: LocalConfig): ChainConfig {
  try {
    const conf = {} as ChainConfig;
    if (lc.assets && Array.isArray(lc.assets)) {
      conf.assets = lc.assets.map((x) => ({
        name: x.base,
        base: x.base,
        display: x.symbol,
        symbol: x.symbol,
        logo_URIs: { svg: x.logo },
        coingecko_id: x.coingecko_id,
        exponent: x.exponent,
        denom_units: [
          { denom: x.base, exponent: 0 },
          { denom: x.symbol.toLowerCase(), exponent: Number(x.exponent) },
        ],
      }));
    }
    conf.versions = {
      cosmosSdk: lc.sdk_version,
    };
    conf.bech32Prefix = lc.addr_prefix;
    conf.bech32ConsensusPrefix = lc.consensus_prefix ?? lc.addr_prefix + 'valcons';
    conf.chainName = lc.chain_name;
    conf.coinType = lc.coin_type;
    conf.prettyName = lc.registry_name || lc.chain_name;
    conf.endpoints = {
      rest: apiConverter(lc.api),
      rpc: apiConverter(lc.rpc),
    };
    if (lc.provider_chain) {
      conf.providerChain = {
        api: apiConverter(lc.provider_chain.api),
      };
    }
    conf.features = lc.features;
    conf.logo = lc.logo;
    conf.keplrFeatures = lc.keplr_features;
    conf.keplrPriceStep = lc.keplr_price_step;
    conf.themeColor = lc.theme_color;
    return conf;
  } catch (error) {
    console.error('Error converting local config:', error);
    throw new Error('Failed to convert local config');
  }
}

export function fromDirectory(source: DirectoryChain): ChainConfig {
  try {
    const conf = {} as ChainConfig;
    conf.assets = source.assets;
    conf.bech32Prefix = source.bech32_prefix;
    conf.bech32ConsensusPrefix = source.bech32_prefix + 'valcons';
    conf.chainId = source.chain_id;
    conf.chainName = source.chain_name;
    conf.prettyName = source.pretty_name;
    conf.versions = {
      application: source.versions?.application_version || '',
      cosmosSdk: source.versions?.cosmos_sdk_version || '',
      tendermint: source.versions?.tendermint_version || '',
    };
    conf.logo = pathConvert(source.image);
    conf.endpoints = source.best_apis;
    return conf;
  } catch (error) {
    console.error('Error converting directory config:', error);
    throw new Error('Failed to convert directory config');
  }
}

// Improved path conversion with better error handling
function pathConvert(path: string | undefined): string {
  if (!path) return '';
  try {
    return path.replace(
      'https://raw.githubusercontent.com/cosmos/chain-registry/master',
      'https://registry.ping.pub'
    );
  } catch (error) {
    console.error('Error converting path:', error);
    return path;
  }
}

// Enhanced logo getter with better type safety
export function getLogo(
  conf:
    | {
        svg?: string;
        png?: string;
        jpeg?: string;
      }
    | undefined
): string | undefined {
  if (!conf) return undefined;
  return pathConvert(conf.svg || conf.png || conf.jpeg);
}

// Improved chain creation with better error handling
function createChainFromDirectory(source: DirectoryChain): Chain {
  try {
    const conf: Chain = {} as Chain;
    conf.apis = source.best_apis;
    conf.bech32_prefix = source.bech32_prefix;
    conf.chain_id = source.chain_id;
    conf.chain_name = source.chain_name;
    conf.explorers = source.explorers;
    conf.pretty_name = source.pretty_name;
    if (source.versions) {
      conf.codebase = {
        recommended_version: source.versions.application_version,
        cosmos_sdk_version: source.versions.cosmos_sdk_version,
        tendermint_version: source.versions.tendermint_version,
      };
    }
    if (source.image) {
      conf.logo_URIs = {
        svg: source.image,
      };
    }
    return conf;
  } catch (error) {
    console.error('Error creating chain from directory:', error);
    throw new Error('Failed to create chain from directory');
  }
}

export enum LoadingStatus {
  Empty = 'empty',
  Loading = 'loading',
  Loaded = 'loaded',
  Error = 'error',
}

export enum NetworkType {
  Mainnet = 'mainnet',
  Testnet = 'testnet',
}

export enum ConfigSource {
  MainnetCosmosDirectory = 'https://chains.cosmos.directory',
  TestnetCosmosDirectory = 'https://chains.testcosmos.directory',
  Local = 'local',
}

// Enhanced dashboard store with better state management
export const useDashboard = defineStore('dashboard', {
  state: () => {
    const favMap = JSON.parse(
      localStorage.getItem('favoriteMap') ||
        '{"cosmos":true, "osmosis":true}'
    );
    return {
      status: LoadingStatus.Empty,
      source: ConfigSource.MainnetCosmosDirectory,
      networkType: NetworkType.Mainnet,
      favoriteMap: favMap as Record<string, boolean>,
      chains: {} as Record<string, ChainConfig>,
      prices: {} as Record<string, any>,
      coingecko: {} as Record<string, { coinId: string; exponent: number; symbol: string }>,
      error: null as string | null,
      lastUpdated: null as Date | null,
    };
  },
  getters: {
    length(): number {
      return Object.keys(this.chains).length;
    },
    isLoading(): boolean {
      return this.status === LoadingStatus.Loading;
    },
    hasError(): boolean {
      return this.status === LoadingStatus.Error;
    },
    favoriteChains(): ChainConfig[] {
      return Object.entries(this.chains)
        .filter(([name]) => this.favoriteMap[name])
        .map(([, chain]) => chain);
    },
  },
  actions: {
    async initial() {
      try {
        this.status = LoadingStatus.Loading;
        await this.loadingFromLocal();
        this.lastUpdated = new Date();
        this.status = LoadingStatus.Loaded;
      } catch (error) {
        this.status = LoadingStatus.Error;
        this.error = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('Error initializing dashboard:', error);
      }
    },
    loadingPrices() {
      try {
        const coinIds = [] as string[];
        const keys = Object.keys(this.chains);
        keys.forEach((k) => {
          if (Array.isArray(this.chains[k]?.assets)) {
            this.chains[k].assets.forEach((a) => {
              if (a.coingecko_id !== undefined && a.coingecko_id.length > 0) {
                coinIds.push(a.coingecko_id);
                a.denom_units.forEach((u) => {
                  this.coingecko[u.denom] = {
                    coinId: a.coingecko_id || '',
                    exponent: u.exponent,
                    symbol: a.symbol,
                  };
                });
              }
            });
          }
        });

        const currencies = ['usd', 'cny'];
        get(
          `https://api.coingecko.com/api/v3/simple/price?include_24hr_change=true&vs_currencies=${currencies.join(
            ','
          )}&ids=${coinIds.join(',')}`
        ).then((x) => {
          this.prices = x;
        });
      } catch (error) {
        console.error('Error loading prices:', error);
      }
    },
    async loadingFromRegistry() {
      if (this.status === LoadingStatus.Empty) {
        try {
          this.status = LoadingStatus.Loading;
          const res = await get(this.source);
          res.chains.forEach((x: DirectoryChain) => {
            this.chains[x.chain_name] = fromDirectory(x);
          });
          this.status = LoadingStatus.Loaded;
          this.lastUpdated = new Date();
        } catch (error) {
          this.status = LoadingStatus.Error;
          this.error = error instanceof Error ? error.message : 'Failed to load from registry';
          console.error('Error loading from registry:', error);
        }
      }
    },
    async loadingFromLocal() {
      try {
        if (window.location.hostname.search('testnet') > -1) {
          this.networkType = NetworkType.Testnet;
        }
        const source: Record<string, LocalConfig> =
          this.networkType === NetworkType.Mainnet
            ? import.meta.glob('../../chains/mainnet/*.json', { eager: true })
            : import.meta.glob('../../chains/testnet/*.json', { eager: true });
        Object.values<LocalConfig>(source).forEach((x: LocalConfig) => {
          this.chains[x.chain_name] = fromLocal(x);
        });
        this.setupDefault();
        this.status = LoadingStatus.Loaded;
        this.lastUpdated = new Date();
      } catch (error) {
        this.status = LoadingStatus.Error;
        this.error = error instanceof Error ? error.message : 'Failed to load from local';
        console.error('Error loading from local:', error);
      }
    },
    async loadLocalConfig(network: NetworkType) {
      try {
        const config: Record<string, ChainConfig> = {};
        const source: Record<string, LocalConfig> =
          network === NetworkType.Mainnet
            ? import.meta.glob('../../chains/mainnet/*.json', { eager: true })
            : import.meta.glob('../../chains/testnet/*.json', { eager: true });
        Object.values<LocalConfig>(source).forEach((x: LocalConfig) => {
          config[x.chain_name] = fromLocal(x);
        });
        return config;
      } catch (error) {
        console.error('Error loading local config:', error);
        throw new Error('Failed to load local config');
      }
    },
    setupDefault() {
      if (this.length > 0) {
        const blockchain = useBlockchain();
        const keys = Object.keys(this.favoriteMap);
        for (let i = 0; i < keys.length; i++) {
          if (!blockchain.chainName && this.chains[keys[i]] && this.favoriteMap[keys[i]]) {
            blockchain.setCurrent(keys[i]);
            break;
          }
        }
        if (!blockchain.chainName) {
          const [first] = Object.keys(this.chains);
          blockchain.setCurrent(first);
        }
        this.loadingPrices();
      }
    },
    setConfigSource(newSource: ConfigSource) {
      this.source = newSource;
      this.initial();
    },
    toggleFavorite(chainName: string) {
      this.favoriteMap[chainName] = !this.favoriteMap[chainName];
      localStorage.setItem('favoriteMap', JSON.stringify(this.favoriteMap));
    },
    clearError() {
      this.error = null;
      this.status = LoadingStatus.Loaded;
    },
  },
});
