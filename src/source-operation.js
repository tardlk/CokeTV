// The original API's branch order is shared by dispatch and timeout selection.
export function sourceOperation(query,operation='api'){
    if(operation==='proxy'||operation==='parse')return operation;
    if('play'in query)return 'play';
    if('ac'in query&&'t'in query)return 'category';
    if('ac'in query&&'ids'in query)return 'detail';
    if('ac'in query&&'action'in query)return 'action';
    if('wd'in query)return 'search';
    if('refresh'in query)return 'refresh';
    return 'home';
}
