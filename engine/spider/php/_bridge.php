<?php
// _bridge.php
// Bridge script to call PHP spider methods from Node.js
// Usage: php _bridge.php <file_path> <method_name> <env_json> <arg1_json> <arg2_json> ...

// Disable error output to stdout to avoid breaking JSON
ini_set('display_errors', 0);
error_reporting(E_ALL);
date_default_timezone_set('Asia/Shanghai');

define('DRPY_BRIDGE', true);

// Helper to send JSON response
function sendResponse($data) {
    // Ensure data is UTF-8 encoded
    // echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit(0);
}

// Helper to send Error response
function sendError($message, $trace = '') {
    echo json_encode([
        'error' => $message,
        'traceback' => $trace
    ], JSON_UNESCAPED_UNICODE);
    exit(1);
}

// Set global error handler to catch warnings/notices and prevent them from corrupting stdout
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    // We can log errors to stderr so they don't mess up stdout JSON
    fwrite(STDERR, "PHP Error [$errno]: $errstr in $errfile on line $errline\n");
    return false; // Let normal error handler continue (but display_errors is 0 so no stdout)
});

// Set exception handler
set_exception_handler(function($e) {
    sendError($e->getMessage(), $e->getTraceAsString());
});

try {
    // 1. Parse Arguments
    if ($argc < 4) {
        throw new Exception("Invalid arguments. Usage: php _bridge.php <file> <method> <env> [args...]");
    }

    $filePath = $argv[1];
    $methodName = $argv[2];
    $envJson = $argv[3];
    $env = json_decode($envJson, true) ?? [];

    $args = [];
    for ($i = 4; $i < $argc; $i++) {
        // Args are passed as individual JSON strings
        $args[] = json_decode($argv[$i], true);
    }

    // 2. Load File
    if (!file_exists($filePath)) {
        throw new Exception("File not found: $filePath");
    }

    // Capture any output during require (e.g. trailing newlines or echoes in file)
    ob_start();
    require_once $filePath;
    $output = ob_get_clean();
    if (trim($output) !== '') {
        fwrite(STDERR, "Output during require: $output\n");
    }

    if (!class_exists('Spider')) {
        throw new Exception("Class 'Spider' not found in $filePath");
    }

    // 3. Instantiate Spider
    $spider = new Spider();

    // 方法名兼容：映射值可能是候选列表（如 "localProxy|proxy"）。
    // 必须选「最派生」的实现：BaseSpider 自身声明了 localProxy()（默认返回 404），
    // 若只按“第一个 method_exists 为真”解析，则只实现 proxy() 的老源会被继承来的
    // localProxy() 抢先命中，回退分支永远不可达（兼容性回归）。
    if (strpos($methodName, '|') !== false) {
        $resolved = null; $inherited = null;
        foreach (explode('|', $methodName) as $candidate) {
            if (!method_exists($spider, $candidate)) continue;
            $declaring = (new ReflectionMethod($spider, $candidate))->getDeclaringClass()->getName();
            if ($declaring !== 'BaseSpider') { $resolved = $candidate; break; }
            $inherited ??= $candidate;
        }
        $resolved ??= $inherited;
        if ($resolved === null) throw new Exception("Method '$methodName' not found in Spider class");
        $methodName = $resolved;
    }

    // AUTO-INIT: Call init() before any other method if it's not init itself
    if ($methodName !== 'init' && method_exists($spider, 'init')) {
        $extend = $env['ext'] ?? '';
        ob_start();
        $spider->init($extend);
        $noise = ob_get_clean();
        if (trim($noise) !== '') fwrite(STDERR, "Output during init: $noise\n");
    }

    // 4. Check Method
    if (!method_exists($spider, $methodName)) {
        // If the method doesn't exist, we might be calling a mapped method that isn't implemented.
        // Or maybe we should check for magic method __call?
        // For now, throw error.
        throw new Exception("Method '$methodName' not found in Spider class");
    }

    // 5. Call Method（收口任何直接输出，最终只通过 sendResponse 输出一行 JSON）
    ob_start();
    $result = call_user_func_array([$spider, $methodName], $args);
    $noise = ob_get_clean();
    if (trim($noise) !== '') fwrite(STDERR, "Output during call: $noise\n");

    // 6. Return Result
    sendResponse($result);

} catch (Throwable $e) {
    sendError($e->getMessage(), $e->getTraceAsString());
}
