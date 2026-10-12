// Emby PascalCase responses adapted from go-emby compat.go with owner permission.
export function sourceDTO(item,version,base,token,sessionId) {
    const query=new URLSearchParams({MediaSourceId:version.id,...(token?{api_key:token}:{}),...(sessionId?{PlaySessionId:sessionId}:{})});
    const url=`${base}/emby/Videos/${item.id}/stream.${version.container||'mp4'}?${query}`;
    return {Id:version.id,ItemId:item.id,Name:version.name,Type:'Default',Protocol:'Http',Path:url,DirectStreamUrl:url,IsRemote:true,Container:version.container||'mp4',SupportsDirectPlay:true,SupportsDirectStream:true,SupportsTranscoding:false,MediaStreams:[],RequiredHttpHeaders:{},AddApiKeyToDirectStreamUrl:false};
}
export function itemDTO(item,{db,serverId,user,base,token}) {
    const state=db.get('userdata',`${user.id}:${item.id}`)||{};
    const folder=['CollectionFolder','Series','Season'].includes(item.type);
    return {Id:item.id,Name:item.name,ServerId:serverId,Type:item.type,IsFolder:folder,MediaType:folder?undefined:'Video',ParentId:item.parentId,
        Overview:item.overview||'',Genres:item.genres||[],ProviderIds:{},Etag:item.etag||item.id,SortName:item.name,ProductionYear:item.year||undefined,
        ImageTags:item.image?{Primary:item.id}:{},BackdropImageTags:[],PrimaryImageAspectRatio:0.667,
        ...(item.type==='CollectionFolder'?{CollectionType:item.kind==='Mixed'?'':item.kind==='Series'?'tvshows':'movies'}:{}),
        ...(item.seriesId?{SeriesId:item.seriesId,SeriesName:item.seriesName,SeasonId:item.seasonId,SeasonName:item.seasonName}:{}),
        ...(item.index!==undefined?{IndexNumber:item.index,ParentIndexNumber:item.parentIndex}:{}),
        UserData:{Key:item.id,PlaybackPositionTicks:state.position||0,Played:!!state.played,PlayCount:state.playCount||0,IsFavorite:!!state.favorite},
        MediaSources:(item.versions||[]).map(v=>sourceDTO(item,v,base,token)),MediaStreams:[],RunTimeTicks:state.duration||undefined,
    };
}
