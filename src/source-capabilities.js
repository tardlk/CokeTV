import {parse} from 'acorn';

// Inspect declarations without importing or evaluating a source. Comments,
// strings containing sample code and unrelated objects are not declarations.
export function sourceCapabilities(code) {
    const defaults = {searchable: true, filterable: false};
    let program;
    try { program = parse(code, {ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true}); }
    catch { return defaults; }
    const bindings = new Map();
    let exported;
    for (const item of program.body) {
        const declaration = item.type === 'ExportNamedDeclaration' ? item.declaration : item;
        if (declaration?.type === 'VariableDeclaration') for (const entry of declaration.declarations) {
            if (entry.id.type === 'Identifier') bindings.set(entry.id.name, entry.init);
        }
        if (item.type === 'ExportDefaultDeclaration') exported = item.declaration;
        if (item.type === 'ExportNamedDeclaration') for (const entry of item.specifiers || []) {
            if ((entry.exported.name || entry.exported.value) === 'default') exported = entry.local;
        }
        const assignment = item.type === 'ExpressionStatement' && item.expression;
        if (assignment?.type === 'AssignmentExpression' && assignment.operator === '=' &&
            assignment.left.type === 'MemberExpression' && (!assignment.left.computed || assignment.left.property.type === 'Literal') &&
            assignment.left.object.name === 'module' && key(assignment.left.property) === 'exports') exported = assignment.right;
    }
    function key(node) { return node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? String(node.value) : undefined; }
    function resolve(node, depth = 0) {
        if (!node || depth > 24) return null;
        if (node.type === 'Identifier') return resolve(bindings.get(node.name), depth + 1);
        if (node.type === 'MemberExpression' && (!node.computed || node.property.type === 'Literal')) return resolve(property(resolve(node.object, depth + 1), key(node.property), depth + 1), depth + 1);
        return node;
    }
    function property(node, name, depth = 0) {
        node = resolve(node, depth + 1);
        if (depth > 24 || node?.type !== 'ObjectExpression') return undefined;
        for (const entry of [...node.properties].reverse()) {
            if (entry.type === 'SpreadElement') {
                const value = property(entry.argument, name, depth + 1);
                if (value !== undefined) return value;
            } else if ((!entry.computed || entry.key.type === 'Literal') && key(entry.key) === name && entry.kind === 'init') return entry.value;
        }
        return undefined;
    }
    function value(node, depth = 0) {
        node = resolve(node, depth + 1);
        if (depth > 24) return undefined;
        if (node?.type === 'Literal') return node.value;
        if (node?.type === 'UnaryExpression' && node.operator === '!') {
            const operand = value(node.argument, depth + 1);
            return operand === undefined ? undefined : !operand;
        }
        return undefined;
    }
    const rule = property(exported, 'rule') ?? bindings.get('rule');
    const meta = property(exported, 'meta');
    for (const name of Object.keys(defaults)) for (const holder of [rule, meta]) {
        const declared = value(property(holder, name));
        if (typeof declared === 'boolean' || typeof declared === 'number' && Number.isFinite(declared) && declared >= 0 ||
            typeof declared === 'string' && /^(?:\d+|true|false)$/.test(declared)) {
            defaults[name] = declared !== false && declared !== 'false' && Number(declared) !== 0;
            break;
        }
    }
    return defaults;
}
