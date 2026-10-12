import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';

const require = createRequire(import.meta.url);
export class EmbyStore {
    constructor(store) {this.store=store;this.directory=path.join(store.directory,'emby');this.db=null;}
    async init() {
        // The protocol follows subscription permissions. Legacy global switch
        // files are preserved, but no longer control availability.
        try {await fs.access(path.join(this.directory,'emby.sqlite'));await this.open();}
        catch(error) {if(error.code!=='ENOENT')throw error;}
        return this;
    }
    async open() {
        if(this.db)return;
        if(this.opening)return this.opening;
        this.opening=this.openDatabase();
        try {await this.opening;}finally{this.opening=null;}
    }
    async openDatabase() {
        await fs.mkdir(this.directory,{recursive:true,mode:0o700});await fs.chmod(this.directory,0o700);
        const file=path.join(this.directory,'emby.sqlite');
        try {const fd=await fs.open(file,'wx',0o600);await fd.close();}catch(error){if(error.code!=='EEXIST')throw error;}
        await fs.chmod(file,0o600);
        const {Database}=require('node-sqlite3-wasm');
        try {
            this.db=new Database(file);
            this.db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(namespace,id));');
            this.bytes=Number(this.db.get('SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM records').bytes);
            const version=this.get('meta','schema');if(version && version!==1)throw Error('schema');
            if(!version)this.put('meta','schema',1);
            if(!this.get('meta','server'))this.put('meta','server',randomUUID().replaceAll('-',''));
        } catch {this.db?.close();this.db=null;throw new Error('Emby数据库不可读，已保留原文件，请恢复备份');}
    }
    get(namespace,id) {const row=this.db?.get('SELECT body FROM records WHERE namespace=? AND id=?',[namespace,id]);return row?JSON.parse(row.body):undefined;}
    all(namespace) {return this.db?this.db.all('SELECT body FROM records WHERE namespace=? ORDER BY id',[namespace]).map(row=>JSON.parse(row.body)):[];}
    put(namespace,id,value) {
        const body=JSON.stringify(value);
        if(Buffer.byteLength(body)>16*1024*1024)throw Object.assign(new Error('Emby条目超过容量限制'),{statusCode:413});
        const previous=this.db.get('SELECT length(CAST(body AS BLOB)) AS bytes FROM records WHERE namespace=? AND id=?',[namespace,id])?.bytes||0;
        const next=this.bytes+Buffer.byteLength(body)-previous;
        if(next>128*1024*1024)throw Object.assign(new Error('Emby数据载荷已达到128MiB限制，请移除条目'),{statusCode:507});
        this.db.run('INSERT INTO records(namespace,id,body) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET body=excluded.body',[namespace,id,body]);
        this.bytes=next;
    }
    remove(namespace,id) {if(!this.db)return;const previous=this.db.get('SELECT length(CAST(body AS BLOB)) AS bytes FROM records WHERE namespace=? AND id=?',[namespace,id])?.bytes||0;this.db.run('DELETE FROM records WHERE namespace=? AND id=?',[namespace,id]);this.bytes-=previous;}
    transaction(fn) {this.db.exec('BEGIN IMMEDIATE');const bytes=this.bytes;try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');this.bytes=bytes;throw error;}}
    id(key) {let value=this.get('identity',key);if(!value){value=randomUUID().replaceAll('-','');this.put('identity',key,value);}return value;}
    close() {this.db?.close();this.db=null;}
}
