/**
 * 代理工具模块
 * 提供代理控制器的公共函数和常量
 * @module proxy-util
 */

import {log, logWarn} from './log.js';

/**
 * 代理相关常量
 */
export const PROXY_CONSTANTS = {
    // 缓存超时时间（5分钟）
    CACHE_TIMEOUT: 5 * 60 * 1000,
    // M3U8 缓存超时时间（30秒，因为直播流更新频繁）
    M3U8_CACHE_TIMEOUT: 30 * 1000,
    // 请求超时时间（30秒）
    REQUEST_TIMEOUT: 30000,
    // HEAD请求超时时间（5秒，用于快速检测）
    HEAD_REQUEST_TIMEOUT: 5000,
    // 内容获取超时时间（15秒）
    CONTENT_FETCH_TIMEOUT: 15000,
    // 流式转发空闲超时（60秒）：resolve 后若上游持续无任何数据则销毁连接，
    // 防止半开 TCP 连接与其 socket 无限悬挂 (L9)
    STREAM_IDLE_TIMEOUT: 60000,
    // 最大内容长度（10MB）
    MAX_CONTENT_LENGTH: 10 * 1024 * 1024,
    // 默认User-Agent
    DEFAULT_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // 缓存管理器配置
    CACHE_MANAGER: {
        // 默认最大缓存条目数
        DEFAULT_MAX_SIZE: 1000,
        // 默认过期时间（5分钟）
        DEFAULT_TTL: 5 * 60 * 1000,
        // M3U8缓存过期时间（30秒）
        M3U8_TTL: 30 * 1000,
        // 清理检查间隔（1分钟）
        CLEANUP_INTERVAL: 60 * 1000,
        // 内存压力阈值（当缓存条目超过此数量时触发积极清理）
        MEMORY_PRESSURE_THRESHOLD: 5000
    }
};

// 所有 SmartCacheManager 实例共享同一个 process 'exit' 钩子 (L17)：
// 一次性注册，进程退出时统一停掉各实例的清理定时器
const smartCacheInstances = new Set();
let smartCacheExitHooked = false;

function registerSmartCacheInstance(instance) {
    smartCacheInstances.add(instance);
    if (smartCacheExitHooked) return;
    smartCacheExitHooked = true;
    process.once('exit', () => {
        for (const inst of smartCacheInstances) {
            try {
                inst.stopCleanupTimer();
            } catch {}
        }
    });
}

/**
 * 智能缓存管理器
 * 提供LRU淘汰、自动过期、内存监控等功能，防止内存泄漏
 */
export class SmartCacheManager {
    constructor(options = {}) {
        this.maxSize = options.maxSize || PROXY_CONSTANTS.CACHE_MANAGER.DEFAULT_MAX_SIZE;
        this.defaultTTL = options.defaultTTL || PROXY_CONSTANTS.CACHE_MANAGER.DEFAULT_TTL;
        this.cleanupInterval = options.cleanupInterval || PROXY_CONSTANTS.CACHE_MANAGER.CLEANUP_INTERVAL;
        this.name = options.name || 'SmartCache';
        
        // 缓存存储：key -> {value, timestamp, accessTime, ttl}
        this.cache = new Map();
        // 访问顺序链表（用于LRU）
        this.accessOrder = new Map();
        
        // 统计信息
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            expirations: 0,
            cleanups: 0
        };
        
        // 启动定期清理任务
        this.startCleanupTimer();

        // L17：退出钩子由模块级共享单例承担（原实现每个实例各注册一个
        // process.on('exit')，实例数逼近 10 即触发 MaxListenersExceededWarning）
        registerSmartCacheInstance(this);

        // log(`[${this.name}] SmartCacheManager initialized: maxSize=${this.maxSize}, defaultTTL=${this.defaultTTL}ms`);
    }
    
    /**
     * 设置缓存项
     * @param {string} key - 缓存键
     * @param {*} value - 缓存值
     * @param {number} ttl - 过期时间（毫秒），可选
     */
    set(key, value, ttl = null) {
        const now = Date.now();
        const itemTTL = ttl || this.defaultTTL;
        
        // 如果已存在，先删除旧的
        if (this.cache.has(key)) {
            this.accessOrder.delete(key);
        }
        
        // 检查是否需要淘汰
        this._evictIfNeeded();
        
        // 添加新项
        const item = {
            value,
            timestamp: now,
            accessTime: now,
            ttl: itemTTL,
            expiresAt: now + itemTTL
        };
        
        this.cache.set(key, item);
        this.accessOrder.set(key, now);
        
        // 内存压力检查
        if (this.cache.size > PROXY_CONSTANTS.CACHE_MANAGER.MEMORY_PRESSURE_THRESHOLD) {
            logWarn(`[${this.name}] Memory pressure detected: ${this.cache.size} items, triggering aggressive cleanup`);
            this._aggressiveCleanup();
        }
    }
    
    /**
     * 获取缓存项
     * @param {string} key - 缓存键
     * @returns {*} 缓存值，如果不存在或已过期返回null
     */
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) {
            this.stats.misses++;
            return null;
        }
        
        const now = Date.now();
        
        // 检查是否过期
        if (now > item.expiresAt) {
            this.cache.delete(key);
            this.accessOrder.delete(key);
            this.stats.misses++;
            this.stats.expirations++;
            return null;
        }
        
        // 更新访问时间（LRU）
        item.accessTime = now;
        this.accessOrder.delete(key);
        this.accessOrder.set(key, now);
        
        this.stats.hits++;
        return item.value;
    }
    
    /**
     * 检查缓存项是否存在且未过期
     * @param {string} key - 缓存键
     * @returns {boolean}
     */
    has(key) {
        return this.get(key) !== null;
    }
    
    /**
     * 删除缓存项
     * @param {string} key - 缓存键
     * @returns {boolean} 是否成功删除
     */
    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.accessOrder.delete(key);
        }
        return deleted;
    }
    
    /**
     * 清空所有缓存
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.accessOrder.clear();
        log(`[${this.name}] Cache cleared: ${size} items removed`);
    }
    
    /**
     * 获取缓存大小
     * @returns {number}
     */
    get size() {
        return this.cache.size;
    }
    
    /**
     * 获取统计信息
     * @returns {Object}
     */
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0 
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
            : '0.00';
            
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            evictions: this.stats.evictions,
            expirations: this.stats.expirations,
            cleanups: this.stats.cleanups,
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: `${hitRate}%`,
            memoryUsage: this._estimateMemoryUsage(),
            name: this.name,
            defaultTTL: this.defaultTTL,
            cleanupInterval: this.cleanupInterval
        };
    }
    
    /**
     * 启动定期清理任务
     */
    startCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        
        this.cleanupTimer = setInterval(() => {
            this._performCleanup();
        }, this.cleanupInterval);

        // 允许进程在定时器存在时退出
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }
    
    /**
     * 停止定期清理任务
     */
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    
    /**
     * 执行清理任务
     */
    _performCleanup() {
        const before = this.cache.size;
        const now = Date.now();
        let expiredCount = 0;
        
        // 清理过期项
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiresAt) {
                this.cache.delete(key);
                this.accessOrder.delete(key);
                expiredCount++;
            }
        }
        
        if (expiredCount > 0) {
            this.stats.expirations += expiredCount;
            this.stats.cleanups++;
            log(`[${this.name}] Cleanup completed: ${expiredCount} expired items removed (${before} -> ${this.cache.size})`);
        }
    }
    
    /**
     * 积极清理（内存压力时）
     */
    _aggressiveCleanup() {
        const targetSize = Math.floor(this.maxSize * 0.7); // 清理到70%容量
        let removedCount = 0;
        
        // 首先清理过期项
        this._performCleanup();
        
        // 如果还是太多，按LRU淘汰
        while (this.cache.size > targetSize && this.accessOrder.size > 0) {
            const oldestKey = this.accessOrder.keys().next().value;
            this.cache.delete(oldestKey);
            this.accessOrder.delete(oldestKey);
            removedCount++;
        }
        
        if (removedCount > 0) {
            this.stats.evictions += removedCount;
            log(`[${this.name}] Aggressive cleanup: ${removedCount} items evicted`);
        }
    }
    
    /**
     * 检查是否需要淘汰并执行LRU淘汰
     */
    _evictIfNeeded() {
        while (this.cache.size >= this.maxSize && this.accessOrder.size > 0) {
            const oldestKey = this.accessOrder.keys().next().value;
            this.cache.delete(oldestKey);
            this.accessOrder.delete(oldestKey);
            this.stats.evictions++;
        }
    }
    
    /**
     * 估算内存使用量（简单估算）
     * @returns {string}
     */
    _estimateMemoryUsage() {
        const avgKeySize = 50; // 平均键长度
        const avgValueSize = 1024; // 平均值大小（1KB）
        const estimatedBytes = this.cache.size * (avgKeySize + avgValueSize);
        
        if (estimatedBytes < 1024) return `${estimatedBytes}B`;
        if (estimatedBytes < 1024 * 1024) return `${(estimatedBytes / 1024).toFixed(1)}KB`;
        return `${(estimatedBytes / (1024 * 1024)).toFixed(1)}MB`;
    }
}

/**
 * 创建缓存管理器工厂函数
 */
export const CacheManagerFactory = {
    /**
     * 创建标准请求缓存管理器
     * @param {string} name - 缓存名称
     * @returns {SmartCacheManager}
     */
    createRequestCache(name = 'RequestCache') {
        return new SmartCacheManager({
            name,
            maxSize: PROXY_CONSTANTS.CACHE_MANAGER.DEFAULT_MAX_SIZE,
            defaultTTL: PROXY_CONSTANTS.CACHE_MANAGER.DEFAULT_TTL,
            cleanupInterval: PROXY_CONSTANTS.CACHE_MANAGER.CLEANUP_INTERVAL
        });
    },
    
    /**
     * 创建M3U8缓存管理器（短TTL）
     * @param {string} name - 缓存名称
     * @returns {SmartCacheManager}
     */
    createM3U8Cache(name = 'M3U8Cache') {
        return new SmartCacheManager({
            name,
            maxSize: 500, // M3U8缓存较小
            defaultTTL: PROXY_CONSTANTS.CACHE_MANAGER.M3U8_TTL,
            cleanupInterval: 30 * 1000 // 30秒清理一次
        });
    },
    
    /**
     * 创建文件缓存管理器
     * @param {string} name - 缓存名称
     * @returns {SmartCacheManager}
     */
    createFileCache(name = 'FileCache') {
        return new SmartCacheManager({
            name,
            maxSize: 2000, // 文件缓存可以更大
            defaultTTL: PROXY_CONSTANTS.CACHE_MANAGER.DEFAULT_TTL,
            cleanupInterval: PROXY_CONSTANTS.CACHE_MANAGER.CLEANUP_INTERVAL
        });
    },
    
    /**
     * 创建客户端连接缓存管理器
     * @param {string} name - 缓存名称
     * @returns {SmartCacheManager}
     */
    createClientCache(name = 'ClientCache') {
        return new SmartCacheManager({
            name,
            maxSize: 100, // 客户端连接数量较少
            defaultTTL: PROXY_CONSTANTS.CACHE_MANAGER.DEFAULT_TTL,
            cleanupInterval: PROXY_CONSTANTS.CACHE_MANAGER.CLEANUP_INTERVAL
        });
    },
    
    /**
     * 创建自定义缓存管理器
     * @param {Object} options - 配置选项
     * @returns {SmartCacheManager}
     */
    createCustomCache(options) {
        return new SmartCacheManager(options);
    }
};

/**
 * 创建标准的健康检查响应
 * @param {string} serviceName - 服务名称
 * @param {Map|SmartCacheManager} requestCache - 请求缓存
 * @param {Map|SmartCacheManager} additionalCache - 额外缓存（可选）
 * @returns {Object} 健康检查响应
 */
export function createHealthResponse(serviceName, requestCache, additionalCache = null) {
    const response = {
        status: 'ok',
        service: serviceName,
        timestamp: new Date().toISOString(),
        cache: {}
    };
    
    // 支持新的SmartCacheManager和旧的Map
    if (requestCache) {
        if (typeof requestCache.getStats === 'function') {
            response.cache.requests = {
                size: requestCache.size,
                stats: requestCache.getStats()
            };
        } else {
            response.cache.requests = requestCache.size;
        }
    }
    
    if (additionalCache) {
        if (typeof additionalCache.getStats === 'function') {
            response.cache.additional = {
                size: additionalCache.size,
                stats: additionalCache.getStats()
            };
        } else {
            response.cache.additional = additionalCache.size;
        }
    }
    
    return response;
}

/**
 * 创建标准的状态响应
 * @param {string} serviceName - 服务名称
 * @param {string} version - 版本号
 * @param {Array} features - 功能列表
 * @param {Array} endpoints - 端点列表
 * @param {Map|SmartCacheManager} requestCache - 请求缓存
 * @param {Map|SmartCacheManager} additionalCache - 额外缓存（可选）
 * @param {Object} additionalInfo - 额外信息（可选）
 * @returns {Object} 状态响应
 */
export function createStatusResponse(serviceName, version, features, endpoints, requestCache, additionalCache = null, additionalInfo = {}) {
    const response = {
        service: serviceName,
        version: version,
        status: 'running',
        cache: {
            timeout: PROXY_CONSTANTS.CACHE_TIMEOUT
        },
        features: features,
        endpoints: endpoints,
        auth: {
            required: true,
            parameter: 'auth',
            description: 'Authentication code required for protected endpoints'
        },
        ...additionalInfo
    };
    
    // 支持新的SmartCacheManager和旧的Map
    if (requestCache) {
        if (typeof requestCache.getStats === 'function') {
            response.cache.requests = {
                size: requestCache.size,
                stats: requestCache.getStats()
            };
        } else {
            response.cache.requests = requestCache.size;
        }
    }
    
    if (additionalCache) {
        if (typeof additionalCache.getStats === 'function') {
            response.cache.additional = {
                size: additionalCache.size,
                stats: additionalCache.getStats()
            };
            response.cache.additionalTimeout = PROXY_CONSTANTS.M3U8_CACHE_TIMEOUT;
        } else {
            response.cache.additional = additionalCache.size;
            response.cache.additionalTimeout = PROXY_CONSTANTS.M3U8_CACHE_TIMEOUT;
        }
    }
    
    return response;
}