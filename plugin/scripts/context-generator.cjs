"use strict";var Qt=Object.create;var te=Object.defineProperty;var zt=Object.getOwnPropertyDescriptor;var Zt=Object.getOwnPropertyNames;var es=Object.getPrototypeOf,ts=Object.prototype.hasOwnProperty;var ss=(r,e)=>{for(var t in e)te(r,t,{get:e[t],enumerable:!0})},$e=(r,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of Zt(e))!ts.call(r,n)&&n!==t&&te(r,n,{get:()=>e[n],enumerable:!(s=zt(e,n))||s.enumerable});return r};var W=(r,e,t)=>(t=r!=null?Qt(es(r)):{},$e(e||!r||!r.__esModule?te(t,"default",{value:r,enumerable:!0}):t,r)),ns=r=>$e(te({},"__esModule",{value:!0}),r);var ks={};ss(ks,{generateContext:()=>Ge});module.exports=ns(ks);var be=W(require("path"),1),Ne=require("os"),Jt=require("fs");var Je=require("bun:sqlite");var O=require("path"),se=require("os"),V=require("fs");var He=require("url");var k=require("fs"),Y=require("path"),Be=require("os"),Se=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(Se||{}),je=(0,Y.join)((0,Be.homedir)(),".agent-recall"),Re=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=(0,Y.join)(je,"logs");(0,k.existsSync)(e)||(0,k.mkdirSync)(e,{recursive:!0});let t=new Date().toISOString().split("T")[0];this.logFilePath=(0,Y.join)(e,`claude-mem-${t}.log`)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e),this.logFilePath=null}}}getLevel(){if(this.level===null)try{let e=(0,Y.join)(je,"settings.json");if((0,k.existsSync)(e)){let t=(0,k.readFileSync)(e,"utf-8"),n=(JSON.parse(t).CLAUDE_MEM_LOG_LEVEL||"INFO").toUpperCase();this.level=Se[n]??1}else this.level=1}catch{this.level=1}return this.level}correlationId(e,t){return`obs-${e}-${t}`}sessionId(e){return`session-${e}`}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?JSON.stringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let s=t;if(typeof t=="string")try{s=JSON.parse(t)}catch{s=t}if(e==="Bash"&&s.command)return`${e}(${s.command})`;if(s.file_path)return`${e}(${s.file_path})`;if(s.notebook_path)return`${e}(${s.notebook_path})`;if(e==="Glob"&&s.pattern)return`${e}(${s.pattern})`;if(e==="Grep"&&s.pattern)return`${e}(${s.pattern})`;if(s.url)return`${e}(${s.url})`;if(s.query)return`${e}(${s.query})`;if(e==="Task"){if(s.subagent_type)return`${e}(${s.subagent_type})`;if(s.description)return`${e}(${s.description})`}return e==="Skill"&&s.skill?`${e}(${s.skill})`:e==="LSP"&&s.operation?`${e}(${s.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${s}-${n} ${o}:${i}:${a}.${d}`}log(e,t,s,n,o){if(e<this.getLevel())return;this.ensureLogFileInitialized();let i=this.formatTimestamp(new Date),a=Se[e].padEnd(5),d=t.padEnd(6),l="";n?.correlationId?l=`[${n.correlationId}] `:n?.sessionId&&(l=`[session-${n.sessionId}] `);let c="";o!=null&&(o instanceof Error?c=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`:this.getLevel()===0&&typeof o=="object"?c=`
`+JSON.stringify(o,null,2):c=" "+this.formatData(o));let _="";if(n){let{sessionId:g,memorySessionId:f,correlationId:T,...m}=n;Object.keys(m).length>0&&(_=` {${Object.entries(m).map(([h,R])=>`${h}=${R}`).join(", ")}}`)}let u=`[${i}] [${a}] [${d}] ${l}${s}${_}${c}`;if(this.logFilePath)try{(0,k.appendFileSync)(this.logFilePath,u+`
`,"utf8")}catch(g){process.stderr.write(`[LOGGER] Failed to write to log file: ${g}
`)}else process.stderr.write(u+`
`)}debug(e,t,s,n){this.log(0,e,t,s,n)}info(e,t,s,n){this.log(1,e,t,s,n)}warn(e,t,s,n){this.log(2,e,t,s,n)}error(e,t,s,n){this.log(3,e,t,s,n)}dataIn(e,t,s,n){this.info(e,`\u2192 ${t}`,s,n)}dataOut(e,t,s,n){this.info(e,`\u2190 ${t}`,s,n)}success(e,t,s,n){this.info(e,`\u2713 ${t}`,s,n)}failure(e,t,s,n){this.error(e,`\u2717 ${t}`,s,n)}timing(e,t,s,n){this.info(e,`\u23F1 ${t}`,n,{duration:`${s}ms`})}happyPathError(e,t,s,n,o=""){let l=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),c=l?`${l[1].split("/").pop()}:${l[2]}`:"unknown",_={...s,location:c};return this.warn(e,`[HAPPY-PATH] ${t}`,_,n),o}},p=new Re;var ds={};function rs(){return typeof __dirname<"u"?__dirname:(0,O.dirname)((0,He.fileURLToPath)(ds.url))}var os=rs(),is=(0,O.join)((0,se.homedir)(),".claude-mem");function as(){if(process.env.AGENT_RECALL_DATA_DIR)return process.env.AGENT_RECALL_DATA_DIR;if(process.env.CLAUDE_MEM_DATA_DIR)return process.env.CLAUDE_MEM_DATA_DIR;let r=(0,O.join)((0,se.homedir)(),".agent-recall"),e=(0,O.join)(r,"settings.json");try{if((0,V.existsSync)(e)){let{readFileSync:s}=require("fs"),n=JSON.parse(s(e,"utf-8")),o=n.env??n;if(o.AGENT_RECALL_DATA_DIR||o.CLAUDE_MEM_DATA_DIR)return o.AGENT_RECALL_DATA_DIR||o.CLAUDE_MEM_DATA_DIR}}catch{}let t=(0,O.join)(is,"settings.json");try{if((0,V.existsSync)(t)){let{readFileSync:s}=require("fs"),n=JSON.parse(s(t,"utf-8")),o=n.env??n;if(o.CLAUDE_MEM_DATA_DIR)return o.CLAUDE_MEM_DATA_DIR}}catch{}return r}var D=as(),F=process.env.CLAUDE_CONFIG_DIR||(0,O.join)((0,se.homedir)(),".claude"),Ps=(0,O.join)(F,"plugins","marketplaces","agent-recall"),Gs=(0,O.join)(F,"plugins","marketplaces","thedotmack"),$s=(0,O.join)(D,"archives"),js=(0,O.join)(D,"logs"),Bs=(0,O.join)(D,"trash"),Hs=(0,O.join)(D,"backups"),Ws=(0,O.join)(D,"modes"),We=(0,O.join)(D,"settings.json"),Ye=(0,O.join)(D,"agent-recall.db");var Ys=(0,O.join)(D,"vector-db"),Vs=(0,O.join)(D,"observer-sessions"),qs=(0,O.join)(F,"settings.json"),Ks=(0,O.join)(F,"commands"),Js=(0,O.join)(F,"CLAUDE.md");function Ve(r){(0,V.mkdirSync)(r,{recursive:!0})}function qe(){return(0,O.join)(os,"..")}var Ke=require("crypto");var cs=3e4;function ne(r,e,t){return(0,Ke.createHash)("sha256").update((r||"")+(e||"")+(t||"")).digest("hex").slice(0,16)}function re(r,e,t){let s=t-cs;return r.prepare("SELECT id, created_at_epoch FROM observations WHERE content_hash = ? AND created_at_epoch > ?").get(e,s)}var oe=class{constructor(e){this.db=e}runAllMigrations(){this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.createAgentRecallCoreTables(),this.addScopeColumns(),this.createSessionArchivesTable(),this.createTemplatesTable(),this.createAuditLogTable(),this.createObservationBufferTable(),this.addObservationPhase1Fields(),this.createSyncStateTable(),this.createCompiledKnowledgeTable(),this.addObservationPhase2Fields(),this.createEntitiesTable(),this.createFactsTable(),this.createAgentDiaryTable(),this.createMarkdownSyncTable(),this.createActivityLogTable(),this.addSessionPrivacyColumn(),this.addObservationPropagatedColumn(),this.createSharedKnowledgeTable(),this.createCompilationLogsTable(),this.addEvidenceTimelineColumn(),this.addStructuredSummaryColumn(),this.addInterruptedSessionStatus()}initializeSchema(){this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT UNIQUE NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT UNIQUE NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(s=>s.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),p.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),p.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),p.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),p.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(s=>s.unique===1)){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}p.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),p.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}p.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),p.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}p.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),p.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}p.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(content_session_id) REFERENCES sdk_sessions(content_session_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(content_session_id, prompt_number);
    `);try{this.db.run(`
        CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
          prompt_text,
          content='user_prompts',
          content_rowid='id'
        );
      `),this.db.run(`
        CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(rowid, prompt_text)
          VALUES (new.id, new.prompt_text);
        END;

        CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
          VALUES('delete', old.id, old.prompt_text);
        END;

        CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
          VALUES('delete', old.id, old.prompt_text);
          INSERT INTO user_prompts_fts(rowid, prompt_text)
          VALUES (new.id, new.prompt_text);
        END;
      `)}catch(s){p.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},s)}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),p.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),p.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),p.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}p.debug("DB","Creating pending_messages table"),this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'processed', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at_epoch INTEGER NOT NULL,
        started_processing_at_epoch INTEGER,
        completed_at_epoch INTEGER,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),p.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;p.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(c=>c.name===o);return a.some(c=>c.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),p.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(p.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?p.debug("DB",`Successfully renamed ${t} session ID columns`):p.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),p.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21)){p.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
        CREATE TABLE observations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          text TEXT,
          type TEXT NOT NULL,
          title TEXT,
          subtitle TEXT,
          facts TEXT,
          narrative TEXT,
          concepts TEXT,
          files_read TEXT,
          files_modified TEXT,
          prompt_number INTEGER,
          discovery_tokens INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `),this.db.run(`
        INSERT INTO observations_new
        SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
               narrative, concepts, files_read, files_modified, prompt_number,
               discovery_tokens, created_at, created_at_epoch
        FROM observations
      `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
        CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
        CREATE INDEX idx_observations_project ON observations(project);
        CREATE INDEX idx_observations_type ON observations(type);
        CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
      `),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run(`
          CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
            INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
          END;

          CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
          END;

          CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
            INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
          END;
        `),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
        CREATE TABLE session_summaries_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          request TEXT,
          investigated TEXT,
          learned TEXT,
          completed TEXT,
          next_steps TEXT,
          files_read TEXT,
          files_edited TEXT,
          notes TEXT,
          prompt_number INTEGER,
          discovery_tokens INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `),this.db.run(`
        INSERT INTO session_summaries_new
        SELECT id, memory_session_id, project, request, investigated, learned,
               completed, next_steps, files_read, files_edited, notes,
               prompt_number, discovery_tokens, created_at, created_at_epoch
        FROM session_summaries
      `),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ai"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ad"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_au"),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
        CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
        CREATE INDEX idx_session_summaries_project ON session_summaries(project);
        CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
      `),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all().length>0&&this.db.run(`
          CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
          END;

          CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
          END;

          CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
            INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
          END;
        `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),p.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(t){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),t}}}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),p.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),p.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}createAgentRecallCoreTables(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)){p.debug("DB","Creating Agent Recall core tables (agent_profiles, bootstrap_state, active_tasks)"),this.db.run("BEGIN TRANSACTION");try{this.db.run(`
        CREATE TABLE IF NOT EXISTS agent_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL DEFAULT 'global',
          profile_type TEXT NOT NULL,
          content_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          updated_at TEXT,
          updated_at_epoch INTEGER
        )
      `),this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_scope_type ON agent_profiles(scope, profile_type)"),this.db.run(`
        CREATE TABLE IF NOT EXISTS bootstrap_state (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending',
          round INTEGER NOT NULL DEFAULT 0,
          started_at TEXT,
          completed_at TEXT,
          metadata_json TEXT
        )
      `),this.db.run(`
        CREATE TABLE IF NOT EXISTS active_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project TEXT NOT NULL,
          task_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'in_progress',
          progress TEXT,
          next_step TEXT,
          context_json TEXT,
          interrupted_tasks_json TEXT,
          started_at TEXT NOT NULL,
          started_at_epoch INTEGER NOT NULL,
          updated_at TEXT,
          updated_at_epoch INTEGER
        )
      `),this.db.run("CREATE INDEX IF NOT EXISTS idx_active_tasks_project ON active_tasks(project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_active_tasks_status ON active_tasks(status)"),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(24,new Date().toISOString()),p.debug("DB","Agent Recall core tables created successfully")}catch(t){throw this.db.run("ROLLBACK"),t}}}addScopeColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(25))return;this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="scope")||(this.db.run("ALTER TABLE observations ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'"),p.debug("DB","Added scope column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(n=>n.name==="scope")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'"),p.debug("DB","Added scope column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(25,new Date().toISOString())}createSessionArchivesTable(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(26)){p.debug("DB","Creating session_archives and sync_policies tables"),this.db.run("BEGIN TRANSACTION");try{this.db.run(`
        CREATE TABLE IF NOT EXISTS session_archives (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT,
          project TEXT NOT NULL,
          summary TEXT,
          key_outcomes TEXT,
          files_changed TEXT,
          tags TEXT,
          duration_minutes INTEGER,
          archived_at TEXT NOT NULL,
          archived_at_epoch INTEGER NOT NULL
        )
      `),this.db.run("CREATE INDEX IF NOT EXISTS idx_session_archives_project ON session_archives(project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_session_archives_date ON session_archives(archived_at_epoch DESC)");try{this.db.run(`
          CREATE VIRTUAL TABLE IF NOT EXISTS session_archives_fts USING fts5(
            summary, key_outcomes, tags,
            content='session_archives',
            content_rowid='id'
          )
        `),this.db.run(`
          CREATE TRIGGER IF NOT EXISTS session_archives_ai AFTER INSERT ON session_archives BEGIN
            INSERT INTO session_archives_fts(rowid, summary, key_outcomes, tags)
            VALUES (new.id, new.summary, new.key_outcomes, new.tags);
          END
        `),this.db.run(`
          CREATE TRIGGER IF NOT EXISTS session_archives_ad AFTER DELETE ON session_archives BEGIN
            INSERT INTO session_archives_fts(session_archives_fts, rowid, summary, key_outcomes, tags)
            VALUES('delete', old.id, old.summary, old.key_outcomes, old.tags);
          END
        `)}catch(t){p.warn("DB","FTS5 not available \u2014 session_archives_fts skipped",{},t)}this.db.run(`
        CREATE TABLE IF NOT EXISTS sync_policies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project TEXT NOT NULL UNIQUE,
          default_action TEXT NOT NULL DEFAULT 'ask',
          created_at TEXT NOT NULL,
          updated_at TEXT
        )
      `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(26,new Date().toISOString()),p.debug("DB","session_archives and sync_policies tables created")}catch(t){throw this.db.run("ROLLBACK"),t}}}createTemplatesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(27))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='templates'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString());return}p.debug("DB","Creating templates table"),this.db.run(`
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        category TEXT,
        content TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        updated_at TEXT,
        updated_at_epoch INTEGER
      )
    `),this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_scope_name ON templates(scope, name)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString()),p.debug("DB","templates table created successfully")}createAuditLogTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(28))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString());return}p.debug("DB","Creating audit_log table"),this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        record_count INTEGER,
        performed_at TEXT NOT NULL,
        performed_at_epoch INTEGER NOT NULL
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_audit_log_epoch ON audit_log(performed_at_epoch)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString()),p.debug("DB","audit_log table created successfully")}createObservationBufferTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(29)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS observation_buffer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_observation_buffer_session ON observation_buffer(session_id);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString()))}addObservationPhase1Fields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(30))return;let t=this.db.prepare("PRAGMA table_info(observations)").all(),s=new Set(t.map(o=>o.name)),n=[{name:"confidence",sql:"ALTER TABLE observations ADD COLUMN confidence TEXT DEFAULT 'medium'"},{name:"tags",sql:"ALTER TABLE observations ADD COLUMN tags TEXT DEFAULT '[]'"},{name:"has_preference",sql:"ALTER TABLE observations ADD COLUMN has_preference INTEGER DEFAULT 0"},{name:"event_date",sql:"ALTER TABLE observations ADD COLUMN event_date TEXT"},{name:"last_referenced_at",sql:"ALTER TABLE observations ADD COLUMN last_referenced_at TEXT"}];for(let o of n)s.has(o.name)||this.db.exec(o.sql);this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(30,new Date().toISOString())}createSyncStateTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(31)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        file_path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        source_type TEXT NOT NULL,
        last_sync_at TEXT NOT NULL
      );
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString()))}createCompiledKnowledgeTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(32)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS compiled_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        topic TEXT NOT NULL,
        content TEXT NOT NULL,
        source_observation_ids TEXT DEFAULT '[]',
        confidence TEXT DEFAULT 'high',
        protected INTEGER DEFAULT 0,
        privacy_scope TEXT DEFAULT 'global',
        version INTEGER DEFAULT 1,
        compiled_at TEXT,
        valid_until TEXT,
        superseded_by INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ck_project ON compiled_knowledge(project);
      CREATE INDEX IF NOT EXISTS idx_ck_topic ON compiled_knowledge(project, topic);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(32,new Date().toISOString()))}addObservationPhase2Fields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(33))return;let t=this.db.prepare("PRAGMA table_info(observations)").all(),s=new Set(t.map(o=>o.name)),n=[{name:"valid_until",sql:"ALTER TABLE observations ADD COLUMN valid_until TEXT"},{name:"superseded_by",sql:"ALTER TABLE observations ADD COLUMN superseded_by INTEGER"},{name:"related_observations",sql:"ALTER TABLE observations ADD COLUMN related_observations TEXT DEFAULT '[]'"}];for(let o of n)s.has(o.name)||this.db.exec(o.sql);this.db.exec(`
      CREATE TABLE IF NOT EXISTS observation_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER REFERENCES observations(id),
        target_id INTEGER REFERENCES observations(id),
        relation TEXT NOT NULL,
        auto_detected INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_obs_links_source ON observation_links(source_id);
      CREATE INDEX IF NOT EXISTS idx_obs_links_target ON observation_links(target_id);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString())}createEntitiesTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(34)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'unknown',
        properties TEXT DEFAULT '{}',
        first_seen_at TEXT,
        last_seen_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString()))}createFactsTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(35)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        subject TEXT REFERENCES entities(id),
        predicate TEXT NOT NULL,
        object TEXT REFERENCES entities(id),
        valid_from TEXT,
        valid_to TEXT,
        confidence REAL DEFAULT 1.0,
        source_observation_id INTEGER,
        source_ref TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(object);
      CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString()))}createAgentDiaryTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(36)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_diary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT,
        project TEXT,
        entry TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_diary_project ON agent_diary(project);
      CREATE INDEX IF NOT EXISTS idx_diary_session ON agent_diary(memory_session_id);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(36,new Date().toISOString()))}createMarkdownSyncTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(37)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS markdown_sync (
        file_path TEXT PRIMARY KEY,
        last_db_hash TEXT,
        last_file_hash TEXT,
        last_sync_at TEXT
      );
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(37,new Date().toISOString()))}createActivityLogTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(38)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        project TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_activity_log_operation ON activity_log(operation);
      CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(38,new Date().toISOString()),p.debug("DB","activity_log table created successfully"))}addSessionPrivacyColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(39))return;this.db.prepare("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="has_private_content")||this.db.exec("ALTER TABLE sdk_sessions ADD COLUMN has_private_content INTEGER DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(39,new Date().toISOString()),p.debug("DB","has_private_content column added to sdk_sessions")}addObservationPropagatedColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(40))return;this.db.prepare("PRAGMA table_info(observations)").all().some(n=>n.name==="propagated")||this.db.exec("ALTER TABLE observations ADD COLUMN propagated INTEGER DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(40,new Date().toISOString()),p.debug("DB","propagated column added to observations")}createSharedKnowledgeTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(41)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS shared_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT,
        content TEXT,
        shared_by TEXT,
        project TEXT,
        shared_at TEXT DEFAULT (datetime('now'))
      )
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(41,new Date().toISOString()),p.debug("DB","shared_knowledge table created"))}createCompilationLogsTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(42)||(this.db.exec(`
      CREATE TABLE IF NOT EXISTS compilation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER DEFAULT 0,
        observations_processed INTEGER DEFAULT 0,
        pages_created INTEGER DEFAULT 0,
        pages_updated INTEGER DEFAULT 0,
        tokens_used INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(42,new Date().toISOString()),p.debug("DB","compilation_logs table created"))}addEvidenceTimelineColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(43))return;this.db.prepare("PRAGMA table_info(compiled_knowledge)").all().some(n=>n.name==="evidence_timeline")||(this.db.exec("ALTER TABLE compiled_knowledge ADD COLUMN evidence_timeline TEXT DEFAULT '[]'"),p.debug("DB","Added evidence_timeline column to compiled_knowledge")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(43,new Date().toISOString())}addStructuredSummaryColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(44))return;this.db.prepare("PRAGMA table_info(session_summaries)").all().some(n=>n.name==="structured_summary")||(this.db.exec("ALTER TABLE session_summaries ADD COLUMN structured_summary TEXT"),p.debug("DB","Added structured_summary column to session_summaries")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(44,new Date().toISOString())}addInterruptedSessionStatus(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(45))return;p.debug("DB","Adding interrupted status to sdk_sessions CHECK constraint");let t=this.db.prepare("PRAGMA table_info(sdk_sessions)").all(),s=t.map(n=>n.name);if(!s.includes("status")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(45,new Date().toISOString());return}this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP TABLE IF EXISTS sdk_sessions_new");let o=`CREATE TABLE sdk_sessions_new (${t.map(a=>{if(a.name==="status")return"status TEXT CHECK(status IN ('active', 'completed', 'failed', 'interrupted')) NOT NULL DEFAULT 'active'";let d=`${a.name} ${a.type}`;return a.notnull&&(d+=" NOT NULL"),a.dflt_value!==null&&(d+=` DEFAULT ${a.dflt_value}`),a.pk&&(d+=" PRIMARY KEY AUTOINCREMENT"),d}).join(", ")}, UNIQUE(content_session_id), UNIQUE(memory_session_id))`;this.db.run(o);let i=s.join(", ");this.db.run(`INSERT INTO sdk_sessions_new SELECT ${i} FROM sdk_sessions`),this.db.run("DROP TABLE sdk_sessions"),this.db.run("ALTER TABLE sdk_sessions_new RENAME TO sdk_sessions"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC)"),this.db.run("COMMIT")}catch(n){throw this.db.run("ROLLBACK"),n}finally{this.db.run("PRAGMA foreign_keys = ON")}this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(45,new Date().toISOString()),p.debug("DB","Added interrupted status to sdk_sessions CHECK constraint")}};var ie=class{db;constructor(e=Ye){e!==":memory:"&&Ve(D),this.db=new Je.Database(e),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA foreign_keys = ON"),this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),new oe(this.db).runAllMigrations()}initializeSchema(){this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT UNIQUE NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT UNIQUE NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(s=>s.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),p.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),p.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),p.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),p.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(s=>s.unique===1)){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}p.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),p.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}p.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),p.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}p.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),p.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}p.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(content_session_id) REFERENCES sdk_sessions(content_session_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(content_session_id, prompt_number);
    `);try{this.db.run(`
        CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
          prompt_text,
          content='user_prompts',
          content_rowid='id'
        );
      `),this.db.run(`
        CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(rowid, prompt_text)
          VALUES (new.id, new.prompt_text);
        END;

        CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
          VALUES('delete', old.id, old.prompt_text);
        END;

        CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
          VALUES('delete', old.id, old.prompt_text);
          INSERT INTO user_prompts_fts(rowid, prompt_text)
          VALUES (new.id, new.prompt_text);
        END;
      `)}catch(s){p.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},s)}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),p.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),p.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),p.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}p.debug("DB","Creating pending_messages table"),this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'processed', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at_epoch INTEGER NOT NULL,
        started_processing_at_epoch INTEGER,
        completed_at_epoch INTEGER,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),p.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;p.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(c=>c.name===o);return a.some(c=>c.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),p.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(p.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?p.debug("DB",`Successfully renamed ${t} session ID columns`):p.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),p.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21)){p.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
        CREATE TABLE observations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          text TEXT,
          type TEXT NOT NULL,
          title TEXT,
          subtitle TEXT,
          facts TEXT,
          narrative TEXT,
          concepts TEXT,
          files_read TEXT,
          files_modified TEXT,
          prompt_number INTEGER,
          discovery_tokens INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `),this.db.run(`
        INSERT INTO observations_new
        SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
               narrative, concepts, files_read, files_modified, prompt_number,
               discovery_tokens, created_at, created_at_epoch
        FROM observations
      `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
        CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
        CREATE INDEX idx_observations_project ON observations(project);
        CREATE INDEX idx_observations_type ON observations(type);
        CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
      `),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run(`
          CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
            INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
          END;

          CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
          END;

          CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
            INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
          END;
        `),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
        CREATE TABLE session_summaries_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          request TEXT,
          investigated TEXT,
          learned TEXT,
          completed TEXT,
          next_steps TEXT,
          files_read TEXT,
          files_edited TEXT,
          notes TEXT,
          prompt_number INTEGER,
          discovery_tokens INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `),this.db.run(`
        INSERT INTO session_summaries_new
        SELECT id, memory_session_id, project, request, investigated, learned,
               completed, next_steps, files_read, files_edited, notes,
               prompt_number, discovery_tokens, created_at, created_at_epoch
        FROM session_summaries
      `),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ai"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ad"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_au"),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
        CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
        CREATE INDEX idx_session_summaries_project ON session_summaries(project);
        CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
      `),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all().length>0&&this.db.run(`
          CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
          END;

          CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
          END;

          CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
            INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
          END;
        `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),p.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(t){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),t}}}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),p.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),p.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}updateMemorySessionId(e,t){this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(t,e)}ensureMemorySessionIdRegistered(e,t){let s=this.db.prepare(`
      SELECT id, memory_session_id FROM sdk_sessions WHERE id = ?
    `).get(e);if(!s)throw new Error(`Session ${e} not found in sdk_sessions`);s.memory_session_id!==t&&(this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(t,e),p.info("DB","Registered memory_session_id before storage (FK fix)",{sessionDbId:e,oldId:s.memory_session_id,newId:t}))}getRecentSummaries(e,t=10){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentSummariesWithSessionInfo(e,t=3){return this.db.prepare(`
      SELECT
        memory_session_id, request, learned, completed, next_steps,
        prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentObservations(e,t=20){return this.db.prepare(`
      SELECT type, text, prompt_number, created_at
      FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getAllRecentObservations(e=100){return this.db.prepare(`
      SELECT id, type, title, subtitle, text, project, prompt_number, created_at, created_at_epoch
      FROM observations
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentSummaries(e=50){return this.db.prepare(`
      SELECT id, request, investigated, learned, completed, next_steps,
             files_read, files_edited, notes, project, prompt_number,
             created_at, created_at_epoch
      FROM session_summaries
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentUserPrompts(e=100){return this.db.prepare(`
      SELECT
        up.id,
        up.content_session_id,
        s.project,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
      LEFT JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      ORDER BY up.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllProjects(){return this.db.prepare(`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
      ORDER BY project ASC
    `).all().map(s=>s.project)}getLatestUserPrompt(e){return this.db.prepare(`
      SELECT
        up.*,
        s.memory_session_id,
        s.project
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.content_session_id = ?
      ORDER BY up.created_at_epoch DESC
      LIMIT 1
    `).get(e)}getUserPromptsBySession(e){return this.db.prepare(`
      SELECT id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch
      FROM user_prompts
      WHERE content_session_id = ?
      ORDER BY prompt_number ASC
    `).all(e)}getRecentSessionsWithStatus(e,t=3){return this.db.prepare(`
      SELECT * FROM (
        SELECT
          s.memory_session_id,
          s.status,
          s.started_at,
          s.started_at_epoch,
          s.user_prompt,
          CASE WHEN sum.memory_session_id IS NOT NULL THEN 1 ELSE 0 END as has_summary
        FROM sdk_sessions s
        LEFT JOIN session_summaries sum ON s.memory_session_id = sum.memory_session_id
        WHERE s.project = ? AND s.memory_session_id IS NOT NULL
        GROUP BY s.memory_session_id
        ORDER BY s.started_at_epoch DESC
        LIMIT ?
      )
      ORDER BY started_at_epoch ASC
    `).all(e,t)}getObservationsForSession(e){return this.db.prepare(`
      SELECT title, subtitle, type, prompt_number
      FROM observations
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch ASC
    `).all(e)}getObservationById(e){return this.db.prepare(`
      SELECT *
      FROM observations
      WHERE id = ?
    `).get(e)||null}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,type:i,concepts:a,files:d}=t,l=s==="date_asc"?"ASC":"DESC",c=n?`LIMIT ${n}`:"",_=e.map(()=>"?").join(","),u=[...e],g=[];if(o&&(g.push("project = ?"),u.push(o)),i)if(Array.isArray(i)){let m=i.map(()=>"?").join(",");g.push(`type IN (${m})`),u.push(...i)}else g.push("type = ?"),u.push(i);if(a){let m=Array.isArray(a)?a:[a],N=m.map(()=>"EXISTS (SELECT 1 FROM json_each(concepts) WHERE value = ?)");u.push(...m),g.push(`(${N.join(" OR ")})`)}if(d){let m=Array.isArray(d)?d:[d],N=m.map(()=>"(EXISTS (SELECT 1 FROM json_each(files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(files_modified) WHERE value LIKE ?))");m.forEach(h=>{u.push(`%${h}%`,`%${h}%`)}),g.push(`(${N.join(" OR ")})`)}let f=g.length>0?`WHERE id IN (${_}) AND ${g.join(" AND ")}`:`WHERE id IN (${_})`;return this.db.prepare(`
      SELECT *
      FROM observations
      ${f}
      ORDER BY created_at_epoch ${l}
      ${c}
    `).all(...u)}getSummaryForSession(e){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `).get(e)||null}getFilesForSession(e){let s=this.db.prepare(`
      SELECT files_read, files_modified
      FROM observations
      WHERE memory_session_id = ?
    `).all(e),n=new Set,o=new Set;for(let i of s){if(i.files_read){let a=JSON.parse(i.files_read);Array.isArray(a)&&a.forEach(d=>n.add(d))}if(i.files_modified){let a=JSON.parse(i.files_modified);Array.isArray(a)&&a.forEach(d=>o.add(d))}}return{filesRead:Array.from(n),filesModified:Array.from(o)}}getSessionById(e){return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project, user_prompt, custom_title
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getSdkSessionsBySessionIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project, user_prompt, custom_title,
             started_at, started_at_epoch, completed_at, completed_at_epoch, status
      FROM sdk_sessions
      WHERE memory_session_id IN (${t})
      ORDER BY started_at_epoch DESC
    `).all(...e)}getPromptNumberFromUserPrompts(e){return this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE content_session_id = ?
    `).get(e).count}createSDKSession(e,t,s,n){let o=new Date,i=o.getTime(),a=this.db.prepare(`
      SELECT id FROM sdk_sessions WHERE content_session_id = ?
    `).get(e);return a?(t&&this.db.prepare(`
          UPDATE sdk_sessions SET project = ?
          WHERE content_session_id = ? AND (project IS NULL OR project = '')
        `).run(t,e),n&&this.db.prepare(`
          UPDATE sdk_sessions SET custom_title = ?
          WHERE content_session_id = ? AND custom_title IS NULL
        `).run(n,e),a.id):(this.db.prepare(`
      INSERT INTO sdk_sessions
      (content_session_id, memory_session_id, project, user_prompt, custom_title, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, 'active')
    `).run(e,t,s,n||null,o.toISOString(),i),this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e).id)}saveUserPrompt(e,t,s){let n=new Date,o=n.getTime();return this.db.prepare(`
      INSERT INTO user_prompts
      (content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?)
    `).run(e,t,s,n.toISOString(),o).lastInsertRowid}getUserPrompt(e,t){return this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `).get(e,t)?.prompt_text??null}storeObservation(e,t,s,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),l=ne(e,s.title,s.narrative),c=re(this.db,l,a);if(c)return{id:c.id,createdAtEpoch:c.created_at_epoch};let u=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch,
       confidence, tags, has_preference, event_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.type,s.title,s.subtitle,JSON.stringify(s.facts),s.narrative,JSON.stringify(s.concepts),JSON.stringify(s.files_read),JSON.stringify(s.files_modified),n||null,o,l,d,a,s.confidence||"medium",JSON.stringify(s.tags||[]),s.has_preference?1:0,s.event_date||null);return{id:Number(u.lastInsertRowid),createdAtEpoch:a}}storeSummary(e,t,s,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),c=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.request,s.investigated,s.learned,s.completed,s.next_steps,s.notes,n||null,o,d,a);return{id:Number(c.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,t,s,n,o,i=0,a){let d=a??Date.now(),l=new Date(d).toISOString();return this.db.transaction(()=>{let _=[],u=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch,
         confidence, tags, has_preference, event_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);for(let f of s){let T=ne(e,f.title,f.narrative),m=re(this.db,T,d);if(m){_.push(m.id);continue}let N=u.run(e,t,f.type,f.title,f.subtitle,JSON.stringify(f.facts),f.narrative,JSON.stringify(f.concepts),JSON.stringify(f.files_read),JSON.stringify(f.files_modified),o||null,i,T,l,d,f.confidence||"medium",JSON.stringify(f.tags||[]),f.has_preference?1:0,f.event_date||null);_.push(Number(N.lastInsertRowid))}let g=null;if(n){let T=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,o||null,i,l,d);g=Number(T.lastInsertRowid)}return{observationIds:_,summaryId:g,createdAtEpoch:d}})()}storeObservationsAndMarkComplete(e,t,s,n,o,i,a,d=0,l){let c=l??Date.now(),_=new Date(c).toISOString();return this.db.transaction(()=>{let g=[],f=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch,
         confidence, tags, has_preference, event_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);for(let N of s){let h=ne(e,N.title,N.narrative),R=re(this.db,h,c);if(R){g.push(R.id);continue}let P=f.run(e,t,N.type,N.title,N.subtitle,JSON.stringify(N.facts),N.narrative,JSON.stringify(N.concepts),JSON.stringify(N.files_read),JSON.stringify(N.files_modified),a||null,d,h,_,c,N.confidence||"medium",JSON.stringify(N.tags||[]),N.has_preference?1:0,N.event_date||null);g.push(Number(P.lastInsertRowid))}let T;if(n){let h=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,a||null,d,_,c);T=Number(h.lastInsertRowid)}return this.db.prepare(`
        UPDATE pending_messages
        SET
          status = 'processed',
          completed_at_epoch = ?,
          tool_input = NULL,
          tool_response = NULL
        WHERE id = ? AND status = 'processing'
      `).run(c,o),{observationIds:g,summaryId:T,createdAtEpoch:c}})()}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o}=t,i=s==="date_asc"?"ASC":"DESC",a=n?`LIMIT ${n}`:"",d=e.map(()=>"?").join(","),l=[...e],c=o?`WHERE id IN (${d}) AND project = ?`:`WHERE id IN (${d})`;return o&&l.push(o),this.db.prepare(`
      SELECT * FROM session_summaries
      ${c}
      ORDER BY created_at_epoch ${i}
      ${a}
    `).all(...l)}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o}=t,i=s==="date_asc"?"ASC":"DESC",a=n?`LIMIT ${n}`:"",d=e.map(()=>"?").join(","),l=[...e],c=o?"AND s.project = ?":"";return o&&l.push(o),this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.id IN (${d}) ${c}
      ORDER BY up.created_at_epoch ${i}
      ${a}
    `).all(...l)}getTimelineAroundTimestamp(e,t=10,s=10,n){return this.getTimelineAroundObservation(null,e,t,s,n)}getTimelineAroundObservation(e,t,s=10,n=10,o){let i=o?"AND project = ?":"",a=o?[o]:[],d,l;if(e!==null){let m=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id <= ? ${i}
        ORDER BY id DESC
        LIMIT ?
      `,N=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id >= ? ${i}
        ORDER BY id ASC
        LIMIT ?
      `;try{let h=this.db.prepare(m).all(e,...a,s+1),R=this.db.prepare(N).all(e,...a,n+1);if(h.length===0&&R.length===0)return{observations:[],sessions:[],prompts:[]};d=h.length>0?h[h.length-1].created_at_epoch:t,l=R.length>0?R[R.length-1].created_at_epoch:t}catch(h){return p.error("DB","Error getting boundary observations",void 0,{error:h,project:o}),{observations:[],sessions:[],prompts:[]}}}else{let m=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch <= ? ${i}
        ORDER BY created_at_epoch DESC
        LIMIT ?
      `,N=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch >= ? ${i}
        ORDER BY created_at_epoch ASC
        LIMIT ?
      `;try{let h=this.db.prepare(m).all(t,...a,s),R=this.db.prepare(N).all(t,...a,n+1);if(h.length===0&&R.length===0)return{observations:[],sessions:[],prompts:[]};d=h.length>0?h[h.length-1].created_at_epoch:t,l=R.length>0?R[R.length-1].created_at_epoch:t}catch(h){return p.error("DB","Error getting boundary timestamps",void 0,{error:h,project:o}),{observations:[],sessions:[],prompts:[]}}}let c=`
      SELECT *
      FROM observations
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,_=`
      SELECT *
      FROM session_summaries
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,u=`
      SELECT up.*, s.project, s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${i.replace("project","s.project")}
      ORDER BY up.created_at_epoch ASC
    `,g=this.db.prepare(c).all(d,l,...a),f=this.db.prepare(_).all(d,l,...a),T=this.db.prepare(u).all(d,l,...a);return{observations:g,sessions:f.map(m=>({id:m.id,memory_session_id:m.memory_session_id,project:m.project,request:m.request,completed:m.completed,next_steps:m.next_steps,created_at:m.created_at,created_at_epoch:m.created_at_epoch})),prompts:T.map(m=>({id:m.id,content_session_id:m.content_session_id,prompt_number:m.prompt_number,prompt_text:m.prompt_text,project:m.project,created_at:m.created_at,created_at_epoch:m.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id = ?
      LIMIT 1
    `).get(e)||null}getPromptsByIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id IN (${t})
      ORDER BY p.created_at_epoch DESC
    `).all(...e)}getSessionSummaryById(e){return this.db.prepare(`
      SELECT
        id,
        memory_session_id,
        content_session_id,
        project,
        user_prompt,
        request_summary,
        learned_summary,
        status,
        created_at,
        created_at_epoch
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getOrCreateManualSession(e){let t=`manual-${e}`,s=`manual-content-${e}`;if(this.db.prepare("SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?").get(t))return t;let o=new Date;return this.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, content_session_id, project, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(t,s,e,o.toISOString(),o.getTime()),p.info("SESSION","Created manual session",{memorySessionId:t,project:e}),t}getCompiledKnowledge(e){return this.db.prepare("SELECT * FROM compiled_knowledge WHERE project = ? AND valid_until IS NULL ORDER BY compiled_at DESC").all(e)}getCompiledKnowledgeByTopic(e,t){return this.db.prepare("SELECT * FROM compiled_knowledge WHERE project = ? AND topic = ? AND valid_until IS NULL ORDER BY version DESC LIMIT 1").get(e,t)||null}upsertCompiledKnowledge(e,t,s,n,o="high"){let i=this.getCompiledKnowledgeByTopic(e,t),a=new Date().toISOString();if(i)return this.db.prepare("UPDATE compiled_knowledge SET content = ?, source_observation_ids = ?, confidence = ?, version = version + 1, compiled_at = ? WHERE id = ?").run(s,JSON.stringify(n),o,a,i.id),i.id;{let d=this.db.prepare("INSERT INTO compiled_knowledge (project, topic, content, source_observation_ids, confidence, compiled_at) VALUES (?, ?, ?, ?, ?, ?)").run(e,t,s,JSON.stringify(n),o,a);return Number(d.lastInsertRowid)}}getObservationsSinceEpoch(e,t){return this.db.prepare("SELECT * FROM observations WHERE project = ? AND created_at_epoch > ? ORDER BY created_at_epoch ASC").all(e,t)}close(){this.db.close()}importSdkSession(e){let t=this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e.content_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO sdk_sessions (
        content_session_id, memory_session_id, project, user_prompt,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.memory_session_id,e.project,e.user_prompt,e.started_at,e.started_at_epoch,e.completed_at,e.completed_at_epoch,e.status).lastInsertRowid}}importSessionSummary(e){let t=this.db.prepare("SELECT id FROM session_summaries WHERE memory_session_id = ?").get(e.memory_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO session_summaries (
        memory_session_id, project, request, investigated, learned,
        completed, next_steps, files_read, files_edited, notes,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.request,e.investigated,e.learned,e.completed,e.next_steps,e.files_read,e.files_edited,e.notes,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}importObservation(e){let t=this.db.prepare(`
      SELECT id FROM observations
      WHERE memory_session_id = ? AND title = ? AND created_at_epoch = ?
    `).get(e.memory_session_id,e.title,e.created_at_epoch);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO observations (
        memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.text,e.type,e.title,e.subtitle,e.facts,e.narrative,e.concepts,e.files_read,e.files_modified,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}importUserPrompt(e){let t=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
    `).get(e.content_session_id,e.prompt_number);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}updateLastReferenced(e){if(e.length===0)return;let t=new Date().toISOString(),s=e.map(()=>"?").join(",");this.db.prepare(`UPDATE observations SET last_referenced_at = ? WHERE id IN (${s})`).run(t,...e)}};var ae=W(require("path"),1);function Qe(r){let e=process.env.HOME||process.env.USERPROFILE||"";return e?ae.default.resolve(r)===ae.default.resolve(e):!1}function ze(r){if(!r||r.trim()==="")return p.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:r}),"unknown-project";let e=ae.default.basename(r);if(e===""){if(process.platform==="win32"){let s=r.match(/^([A-Z]):\\/i);if(s){let o=`drive-${s[1].toUpperCase()}`;return p.info("PROJECT_NAME","Drive root detected",{cwd:r,projectName:o}),o}}return p.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:r}),"unknown-project"}return e}var U=require("fs"),ce=require("path"),Ze=require("os"),de=class{static DEFAULTS={CLAUDE_MEM_MODEL:"claude-sonnet-4-5",CLAUDE_MEM_CONTEXT_OBSERVATIONS:"50",CLAUDE_MEM_WORKER_PORT:"37777",CLAUDE_MEM_WORKER_HOST:"127.0.0.1",CLAUDE_MEM_SKIP_TOOLS:"ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion",CLAUDE_MEM_PROVIDER:"claude",CLAUDE_MEM_CLAUDE_AUTH_METHOD:"cli",CLAUDE_MEM_GEMINI_API_KEY:"",CLAUDE_MEM_GEMINI_MODEL:"gemini-2.5-flash-lite",CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED:"true",CLAUDE_MEM_OPENROUTER_API_KEY:"",CLAUDE_MEM_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",CLAUDE_MEM_OPENROUTER_SITE_URL:"",CLAUDE_MEM_OPENROUTER_APP_NAME:"agent-recall",CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_OPENROUTER_MAX_TOKENS:"100000",CLAUDE_MEM_DATA_DIR:(0,ce.join)((0,Ze.homedir)(),".agent-recall"),CLAUDE_MEM_LOG_LEVEL:"INFO",CLAUDE_MEM_PYTHON_VERSION:"3.13",CLAUDE_CODE_PATH:"",CLAUDE_MEM_MODE:"code",CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT:"true",CLAUDE_MEM_CONTEXT_FULL_COUNT:"0",CLAUDE_MEM_CONTEXT_FULL_FIELD:"narrative",CLAUDE_MEM_CONTEXT_SESSION_COUNT:"10",CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY:"true",CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE:"false",CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED:"false",CLAUDE_MEM_MAX_CONCURRENT_AGENTS:"2",CLAUDE_MEM_RATE_LIMIT_PAUSE_SECONDS:"300",CLAUDE_MEM_EXCLUDED_PROJECTS:"",CLAUDE_MEM_FOLDER_MD_EXCLUDE:"[]",AGENT_RECALL_VECTOR_BACKEND:"seekdb",CLAUDE_MEM_DATA_RETENTION_DAYS:"90",CLAUDE_MEM_SUMMARY_RETENTION_DAYS:"365",CLAUDE_MEM_AUTO_CLEANUP_ENABLED:"false",CLAUDE_MEM_AUDIT_REVIEW_INTERVAL_DAYS:"30",AGENT_RECALL_COMPILATION_MODEL:"claude-opus-4-6",AGENT_RECALL_AI_MERGE_ENABLED:"true",AGENT_RECALL_MERMAID_ENABLED:"true"};static getAllDefaults(){return{...this.DEFAULTS}}static get(e){return process.env[e]??this.DEFAULTS[e]}static getInt(e){let t=this.get(e);return parseInt(t,10)}static getBool(e){let t=this.get(e);return t==="true"||t===!0}static applyEnvOverrides(e){let t={...e};for(let s of Object.keys(this.DEFAULTS))process.env[s]!==void 0&&(t[s]=process.env[s]);return t}static loadFromFile(e){try{if(!(0,U.existsSync)(e)){let i=this.getAllDefaults();try{let a=(0,ce.dirname)(e);(0,U.existsSync)(a)||(0,U.mkdirSync)(a,{recursive:!0}),(0,U.writeFileSync)(e,JSON.stringify(i,null,2),"utf-8"),console.log("[SETTINGS] Created settings file with defaults:",e)}catch(a){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,a)}return this.applyEnvOverrides(i)}let t=(0,U.readFileSync)(e,"utf-8"),s=JSON.parse(t),n=s;if(s.env&&typeof s.env=="object"){n=s.env;try{(0,U.writeFileSync)(e,JSON.stringify(n,null,2),"utf-8"),console.log("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(i){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,i)}}let o={...this.DEFAULTS};for(let i of Object.keys(this.DEFAULTS))n[i]!==void 0&&(o[i]=n[i]);return this.applyEnvOverrides(o)}catch(t){return console.warn("[SETTINGS] Failed to load settings, using defaults:",e,t),this.applyEnvOverrides(this.getAllDefaults())}}};var q=require("fs"),pe=require("path");var v=class r{static instance=null;activeMode=null;modesDir;constructor(){let e=qe(),t=[(0,pe.join)(e,"modes"),(0,pe.join)(e,"..","plugin","modes")],s=t.find(n=>(0,q.existsSync)(n));this.modesDir=s||t[0]}static getInstance(){return r.instance||(r.instance=new r),r.instance}parseInheritance(e){let t=e.split("--");if(t.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(t.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:t[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,t){let s={...e};for(let n in t){let o=t[n],i=e[n];this.isPlainObject(o)&&this.isPlainObject(i)?s[n]=this.deepMerge(i,o):s[n]=o}return s}loadModeFile(e){let t=(0,pe.join)(this.modesDir,`${e}.json`);if(!(0,q.existsSync)(t))throw new Error(`Mode file not found: ${t}`);let s=(0,q.readFileSync)(t,"utf-8");return JSON.parse(s)}loadMode(e){let t=this.parseInheritance(e);if(!t.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,p.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(l=>l.id),concepts:d.observation_concepts.map(l=>l.id)}),d}catch{if(p.warn("SYSTEM",`Mode file not found: ${e}, falling back to 'code'`),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:s,overrideId:n}=t,o;try{o=this.loadMode(s)}catch{p.warn("SYSTEM",`Parent mode '${s}' not found for ${e}, falling back to 'code'`),o=this.loadMode("code")}let i;try{i=this.loadModeFile(n),p.debug("SYSTEM",`Loaded override file: ${n} for parent ${s}`)}catch{return p.warn("SYSTEM",`Override file '${n}' not found, using parent mode '${s}' only`),this.activeMode=o,o}if(!i)return p.warn("SYSTEM",`Invalid override file: ${n}, using parent mode '${s}' only`),this.activeMode=o,o;let a=this.deepMerge(o,i);return this.activeMode=a,p.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${s} + ${n})`,void 0,{parent:s,override:n,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getObservationConcepts(){return this.getActiveMode().observation_concepts}getTypeIcon(e){return this.getObservationTypes().find(s=>s.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(s=>s.id===e)?.work_emoji||"\u{1F4DD}"}validateType(e){return this.getObservationTypes().some(t=>t.id===e)}getTypeLabel(e){return this.getObservationTypes().find(s=>s.id===e)?.label||e}};function Oe(){let r=We,e=de.loadFromFile(r),t=v.getInstance().getActiveMode(),s=new Set(t.observation_types.map(o=>o.id)),n=new Set(t.observation_concepts.map(o=>o.id));return{totalObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.CLAUDE_MEM_CONTEXT_SESSION_COUNT,10),showReadTokens:e.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:s,observationConcepts:n,fullObservationField:e.CLAUDE_MEM_CONTEXT_FULL_FIELD,showLastSummary:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE==="true"}}var E={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},et=4,Ie=1;function Ae(r){let e=(r.title?.length||0)+(r.subtitle?.length||0)+(r.narrative?.length||0)+JSON.stringify(r.facts||[]).length;return Math.ceil(e/et)}function Le(r){let e=r.length,t=r.reduce((i,a)=>i+Ae(a),0),s=r.reduce((i,a)=>i+(a.discovery_tokens||0),0),n=s-t,o=s>0?Math.round(n/s*100):0;return{totalObservations:e,totalReadTokens:t,totalDiscoveryTokens:s,savings:n,savingsPercent:o}}function ps(r){return v.getInstance().getWorkEmoji(r)}function K(r,e){let t=Ae(r),s=r.discovery_tokens||0,n=ps(r.type),o=s>0?`${n} ${s.toLocaleString()}`:"-";return{readTokens:t,discoveryTokens:s,discoveryDisplay:o,workEmoji:n}}function le(r){return r.showReadTokens||r.showWorkTokens||r.showSavingsAmount||r.showSavingsPercent}var tt=W(require("path"),1),Ee=require("fs");var st=2;function ve(r,e,t){let s=Array.from(t.observationTypes),n=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(","),a=t.totalObservationCount*st,d=r.db.prepare(`
    SELECT
      id, memory_session_id, type, title, subtitle, narrative,
      facts, concepts, files_read, files_modified, discovery_tokens,
      created_at, created_at_epoch
    FROM observations
    WHERE project = ?
      AND type IN (${n})
      AND EXISTS (
        SELECT 1 FROM json_each(concepts)
        WHERE value IN (${i})
      )
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(e,...s,...o,a);return ye(d,t.totalObservationCount)}function Ce(r,e,t){return r.db.prepare(`
    SELECT id, memory_session_id, request, investigated, learned, completed, next_steps, structured_summary, created_at, created_at_epoch
    FROM session_summaries
    WHERE project = ?
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(e,t.sessionCount+Ie)}function nt(r,e,t){let s=Array.from(t.observationTypes),n=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(","),a=e.map(()=>"?").join(","),d=t.totalObservationCount*st,l=r.db.prepare(`
    SELECT
      id, memory_session_id, type, title, subtitle, narrative,
      facts, concepts, files_read, files_modified, discovery_tokens,
      created_at, created_at_epoch, project
    FROM observations
    WHERE project IN (${a})
      AND type IN (${n})
      AND EXISTS (
        SELECT 1 FROM json_each(concepts)
        WHERE value IN (${i})
      )
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(...e,...s,...o,d);return ye(l,t.totalObservationCount)}function rt(r,e,t){let s=e.map(()=>"?").join(",");return r.db.prepare(`
    SELECT id, memory_session_id, request, investigated, learned, completed, next_steps, structured_summary, created_at, created_at_epoch, project
    FROM session_summaries
    WHERE project IN (${s})
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(...e,t.sessionCount+Ie)}function ls(r,e){let t=(e-r.created_at_epoch)/3600,s=Math.max(0,1-t/168),n=0;if(r.title&&r.title.trim().length>0&&(n+=.1),r.facts)try{let o=JSON.parse(r.facts);Array.isArray(o)&&(n+=Math.min(o.length*.1,.3))}catch{r.facts.trim().length>0&&(n+=.1)}if(r.concepts)try{let o=JSON.parse(r.concepts);Array.isArray(o)&&(n+=Math.min(o.length*.05,.2))}catch{r.concepts.trim().length>0&&(n+=.05)}if(r.narrative&&r.narrative.trim().length>0&&(n+=.1),r.files_modified)try{let o=JSON.parse(r.files_modified);Array.isArray(o)&&o.length>0&&(n+=.1)}catch{r.files_modified.trim().length>0&&(n+=.1)}return s+n}function ye(r,e){if(r.length<=e)return r;let t=Math.floor(Date.now()/1e3),s=r.map(o=>({obs:o,score:ls(o,t)}));s.sort((o,i)=>i.score-o.score);let n=s.slice(0,e).map(o=>o.obs);return n.sort((o,i)=>i.created_at_epoch-o.created_at_epoch),n}function Es(r){return r.replace(/\//g,"-")}function _s(r){try{if(!(0,Ee.existsSync)(r))return{userMessage:"",assistantMessage:""};let e=(0,Ee.readFileSync)(r,"utf-8").trim();if(!e)return{userMessage:"",assistantMessage:""};let t=e.split(`
`).filter(n=>n.trim()),s="";for(let n=t.length-1;n>=0;n--)try{let o=t[n];if(!o.includes('"type":"assistant"'))continue;let i=JSON.parse(o);if(i.type==="assistant"&&i.message?.content&&Array.isArray(i.message.content)){let a="";for(let d of i.message.content)d.type==="text"&&(a+=d.text);if(a=a.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g,"").trim(),a){s=a;break}}}catch(o){p.debug("PARSER","Skipping malformed transcript line",{lineIndex:n},o);continue}return{userMessage:"",assistantMessage:s}}catch(e){return p.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r},e),{userMessage:"",assistantMessage:""}}}function De(r,e,t,s){if(!e.showLastMessage||r.length===0)return{userMessage:"",assistantMessage:""};let n=r.find(d=>d.memory_session_id!==t);if(!n)return{userMessage:"",assistantMessage:""};let o=n.memory_session_id,i=Es(s),a=tt.default.join(F,"projects",i,`${o}.jsonl`);return _s(a)}function ot(r,e){let t=e[0]?.id;return r.map((s,n)=>{let o=n===0?null:e[n+1];return{...s,displayEpoch:o?o.created_at_epoch:s.created_at_epoch,displayTime:o?o.created_at:s.created_at,shouldShowLink:s.id!==t}})}function Me(r,e){let t=[...r.map(s=>({type:"observation",data:s})),...e.map(s=>({type:"summary",data:s}))];return t.sort((s,n)=>{let o=s.type==="observation"?s.data.created_at_epoch:s.data.displayEpoch,i=n.type==="observation"?n.data.created_at_epoch:n.data.displayEpoch;return o-i}),t}function it(r,e){return new Set(r.slice(0,e).map(t=>t.id))}function at(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function dt(r){return[`# $CMEM ${r} ${at()}`,""]}function ct(){return[`Legend: \u{1F3AF}session ${v.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji}${t.id}`).join(" ")}`,"Format: ID TIME TYPE TITLE","Fetch details: get_observations([IDs]) | Search: mem-search skill",""]}function pt(){return[]}function lt(){return[]}function Et(r,e){let t=[],s=[`${r.totalObservations} obs (${r.totalReadTokens.toLocaleString()}t read)`,`${r.totalDiscoveryTokens.toLocaleString()}t work`];return r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)&&(e.showSavingsPercent?s.push(`${r.savingsPercent}% savings`):e.showSavingsAmount&&s.push(`${r.savings.toLocaleString()}t saved`)),t.push(`Stats: ${s.join(" | ")}`),t.push(""),t}function _t(r){return[`### ${r}`]}function ut(r){return r.toLowerCase().replace(" am","a").replace(" pm","p")}function mt(r,e,t){let s=r.title||"Untitled",n=v.getInstance().getTypeIcon(r.type),o=e?ut(e):'"';return`${r.id} ${o} ${n} ${s}`}function Tt(r,e,t,s){let n=[],o=r.title||"Untitled",i=v.getInstance().getTypeIcon(r.type),a=e?ut(e):'"',{readTokens:d,discoveryDisplay:l}=K(r,s);n.push(`**${r.id}** ${a} ${i} **${o}**`),t&&n.push(t);let c=[];return s.showReadTokens&&c.push(`~${d}t`),s.showWorkTokens&&c.push(l),c.length>0&&n.push(c.join(" ")),n.push(""),n}function gt(r,e){return[`S${r.id} ${r.request||"Session started"} (${e})`]}function J(r,e){return e?[`**${r}**: ${e}`,""]:[]}function ft(r){return r.assistantMessage?["","---","","**Previously**","",`A: ${r.assistantMessage}`,""]:[]}function ht(r,e){return["",`Access ${Math.round(r/1e3)}k tokens of past work via get_observations([IDs]) or mem-search skill.`]}function bt(r){return`# $CMEM ${r} ${at()}

No previous sessions found.`}function Nt(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function St(r){return["",`${E.bright}${E.cyan}[${r}] recent context, ${Nt()}${E.reset}`,`${E.gray}${"\u2500".repeat(60)}${E.reset}`,""]}function Rt(){let e=v.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ");return[`${E.dim}Legend: session-request | ${e}${E.reset}`,""]}function Ot(){return[`${E.bright}Column Key${E.reset}`,`${E.dim}  Read: Tokens to read this observation (cost to learn it now)${E.reset}`,`${E.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${E.reset}`,""]}function It(){return[`${E.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${E.reset}`,"",`${E.dim}When you need implementation details, rationale, or debugging context:${E.reset}`,`${E.dim}  - Fetch by ID: get_observations([IDs]) for observations visible in this index${E.reset}`,`${E.dim}  - Search history: Use the mem-search skill for past decisions, bugs, and deeper research${E.reset}`,`${E.dim}  - Trust this index over re-reading code for past decisions and learnings${E.reset}`,""]}function At(r,e){let t=[];if(t.push(`${E.bright}${E.cyan}Context Economics${E.reset}`),t.push(`${E.dim}  Loading: ${r.totalObservations} observations (${r.totalReadTokens.toLocaleString()} tokens to read)${E.reset}`),t.push(`${E.dim}  Work investment: ${r.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${E.reset}`),r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let s="  Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?s+=`${r.savings.toLocaleString()} tokens (${r.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?s+=`${r.savings.toLocaleString()} tokens`:s+=`${r.savingsPercent}% reduction from reuse`,t.push(`${E.green}${s}${E.reset}`)}return t.push(""),t}function Lt(r){return[`${E.bright}${E.cyan}${r}${E.reset}`,""]}function vt(r){return[`${E.dim}${r}${E.reset}`]}function Ct(r,e,t,s){let n=r.title||"Untitled",o=v.getInstance().getTypeIcon(r.type),{readTokens:i,discoveryTokens:a,workEmoji:d}=K(r,s),l=t?`${E.dim}${e}${E.reset}`:" ".repeat(e.length),c=s.showReadTokens&&i>0?`${E.dim}(~${i}t)${E.reset}`:"",_=s.showWorkTokens&&a>0?`${E.dim}(${d} ${a.toLocaleString()}t)${E.reset}`:"";return`  ${E.dim}#${r.id}${E.reset}  ${l}  ${o}  ${n} ${c} ${_}`}function yt(r,e,t,s,n){let o=[],i=r.title||"Untitled",a=v.getInstance().getTypeIcon(r.type),{readTokens:d,discoveryTokens:l,workEmoji:c}=K(r,n),_=t?`${E.dim}${e}${E.reset}`:" ".repeat(e.length),u=n.showReadTokens&&d>0?`${E.dim}(~${d}t)${E.reset}`:"",g=n.showWorkTokens&&l>0?`${E.dim}(${c} ${l.toLocaleString()}t)${E.reset}`:"";return o.push(`  ${E.dim}#${r.id}${E.reset}  ${_}  ${a}  ${E.bright}${i}${E.reset}`),s&&o.push(`    ${E.dim}${s}${E.reset}`),(u||g)&&o.push(`    ${u} ${g}`),o.push(""),o}function Dt(r,e){let t=`${r.request||"Session started"} (${e})`;return[`${E.yellow}#S${r.id}${E.reset} ${t}`,""]}function Q(r,e,t){return e?[`${t}${r}:${E.reset} ${e}`,""]:[]}function Mt(r){return r.assistantMessage?["","---","",`${E.bright}${E.magenta}Previously${E.reset}`,"",`${E.dim}A: ${r.assistantMessage}${E.reset}`,""]:[]}function Ut(r,e){let t=Math.round(r/1e3);return["",`${E.dim}Access ${t}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use the mem-search skill to access memories by ID.${E.reset}`]}function kt(r){return`
${E.bright}${E.cyan}[${r}] recent context, ${Nt()}${E.reset}
${E.gray}${"\u2500".repeat(60)}${E.reset}

${E.dim}No previous sessions found for this project yet.${E.reset}
`}function xt(r,e,t,s){let n=[];return s?n.push(...St(r)):n.push(...dt(r)),s?n.push(...Rt()):n.push(...ct()),s?n.push(...Ot()):n.push(...pt()),s?n.push(...It()):n.push(...lt()),le(t)&&(s?n.push(...At(e,t)):n.push(...Et(e,t))),n}var Ue=W(require("path"),1);function G(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[]}catch(e){return p.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:r?.substring(0,50)},e),[]}}function ke(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function xe(r){return new Date(r).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function Ft(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function wt(r,e){return Ue.default.isAbsolute(r)?Ue.default.relative(e,r):r}function Xt(r,e,t){let s=G(r);if(s.length>0)return wt(s[0],e);if(t){let n=G(t);if(n.length>0)return wt(n[0],e)}return"General"}function us(r){let e=new Map;for(let s of r){let n=s.type==="observation"?s.data.created_at:s.data.displayTime,o=Ft(n);e.has(o)||e.set(o,[]),e.get(o).push(s)}let t=Array.from(e.entries()).sort((s,n)=>{let o=new Date(s[0]).getTime(),i=new Date(n[0]).getTime();return o-i});return new Map(t)}function Pt(r,e){return e.fullObservationField==="narrative"?r.narrative:r.facts?G(r.facts).join(`
`):null}function ms(r,e,t,s,n=!1){let o=[];o.push(..._t(r));let i="";for(let a of e)if(a.type==="summary"){i="";let d=a.data,l=ke(d.displayTime);o.push(...gt(d,l))}else{let d=a.data,l=xe(d.created_at),_=l!==i?l:"";if(i=l,n){let g=d.facts&&G(d.facts)[0]||"";o.push(`- [${d.type}] ${d.title}${g?": "+g:""}`);continue}if(t.has(d.id)){let g=Pt(d,s);o.push(...Tt(d,_,g,s))}else o.push(mt(d,_,s))}return o}function Ts(r,e,t,s,n,o=!1){let i=[];i.push(...Lt(r));let a=null,d="";for(let l of e)if(l.type==="summary"){a=null,d="";let c=l.data,_=ke(c.displayTime);i.push(...Dt(c,_))}else{let c=l.data,_=Xt(c.files_modified,n,c.files_read),u=xe(c.created_at),g=u!==d;if(d=u,o){let T=c.facts&&G(c.facts)[0]||"";i.push(`- [${c.type}] ${c.title}${T?": "+T:""}`);continue}let f=t.has(c.id);if(_!==a&&(i.push(...vt(_)),a=_),f){let T=Pt(c,s);i.push(...yt(c,u,g,T,s))}else i.push(Ct(c,u,g,s))}return i.push(""),i}function gs(r,e,t,s,n,o,i=!1){return o?Ts(r,e,t,s,n,i):ms(r,e,t,s,i)}function Gt(r,e,t,s,n,o=!1){let i=[],a=us(r);for(let[d,l]of a)i.push(...gs(d,l,e,t,s,n,o));return i}function $t(r,e,t){return!(!r.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||t&&e.created_at_epoch<=t.created_at_epoch)}function jt(r,e){let t=[];return e?(t.push(...Q("Investigated",r.investigated,E.blue)),t.push(...Q("Learned",r.learned,E.yellow)),t.push(...Q("Completed",r.completed,E.green)),t.push(...Q("Next Steps",r.next_steps,E.magenta))):(t.push(...J("Investigated",r.investigated)),t.push(...J("Learned",r.learned)),t.push(...J("Completed",r.completed)),t.push(...J("Next Steps",r.next_steps))),t}function Bt(r,e){return e?Mt(r):ft(r)}function Ht(r,e,t){return!le(e)||r.totalDiscoveryTokens<=0||r.savings<=0?[]:t?Ut(r.totalDiscoveryTokens,r.totalReadTokens):ht(r.totalDiscoveryTokens,r.totalReadTokens)}function we(r,e){if(!r)return[];let t=r.agent_soul,s=r.user;if(!t?.name&&!t?.vibe&&!s?.name)return[];let n=[];return n.push("<agent-identity>"),t?.name&&n.push(`You are ${t.name}.`),t?.self_description&&n.push(t.self_description),t?.vibe&&n.push(`Style: ${t.vibe}`),t?.running_environment&&n.push(`Running on: ${t.running_environment}`),s?.name&&(n.push(""),n.push(`User: ${s.name}`),s.role&&n.push(`Role: ${s.role}`),s.language&&n.push(`Language: ${s.language}`)),r.style?.tone&&(n.push(""),n.push(`Communication: ${r.style.tone}`)),n.push("</agent-identity>"),n.push(""),n}function fs(r){if(!r||r.length===0)return[];let e=[],t=r.filter(i=>i.status==="completed").length,s=r.length,n=r.find(i=>i.status==="in_progress"),o=n?n.name:"All complete";e.push(`Progress: Step ${n?t+1:t}/${s} \u2014 ${o}`);for(let i of r)i.status==="completed"?e.push(`[x] ${i.name}`):i.status==="in_progress"?e.push(`[>] ${i.name}  \u2190 current`):e.push(`[ ] ${i.name}`);return e}function Fe(r,e){if(!r)return[];let t=[];t.push("<active-task>"),r.status==="blocked"?(t.push(`**Blocked Task**: ${r.task_name}`),r.progress&&t.push(`Progress: ${r.progress}`),r.next_step&&t.push(`Blocker: ${r.next_step}`)):t.push(`**Active Task**: ${r.task_name}`);let s=!1;if(r.context_json)try{let n=JSON.parse(r.context_json);Array.isArray(n.checkpoints)&&n.checkpoints.length>0&&(s=!0,t.push(...fs(n.checkpoints)))}catch{}if(!s&&r.status!=="blocked"&&(r.progress&&t.push(`Progress: ${r.progress}`),r.next_step&&t.push(`Next: ${r.next_step}`)),r.interrupted_tasks_json)try{let n=JSON.parse(r.interrupted_tasks_json);if(Array.isArray(n)&&n.length>0){t.push(""),t.push("Interrupted tasks:");for(let o of n)t.push(`- ${o.task_name||o.name} (paused at: ${o.progress||"unknown"})`)}}catch{}return t.push("</active-task>"),t.push(""),t}function Wt(r){let e="## Memory Protocol";return[r?`\x1B[1;36m${e}\x1B[0m`:e,"1. Before answering about past facts, search memory to verify \u2014 do not guess","2. When you discover information contradicting stored memory, flag it and request an update","3. User preferences, decisions, and corrections are worth recording",""]}var hs={L0:.08,L1:.15,L2:.6,L3:.17},me=["L0","L1","L2","L3"],bs=3e3,Ns=1500,Ss=8e3,L=class{totalBudget;allocations;consumed;constructor(e=bs){this.totalBudget=Math.min(Math.max(e,Ns),Ss);let t={},s=0;for(let o=0;o<me.length-1;o++){let i=me[o];t[i]=Math.floor(this.totalBudget*hs[i]),s+=t[i]}let n=me[me.length-1];t[n]=this.totalBudget-s,this.allocations=t,this.consumed={L0:0,L1:0,L2:0,L3:0}}getBudget(e){return this.allocations[e]}remaining(e){return this.allocations[e]-this.consumed[e]}canFit(e,t){return t<=this.remaining(e)}consume(e,t){this.consumed[e]+=t}static estimateTokens(e){return!e||e.length===0?0:Math.ceil(e.length/4)}};var Yt={agent_soul:[{field:"name",required:!0},{field:"self_description",required:!1},{field:"core_values",required:!1},{field:"vibe",required:!1}],user:[{field:"name",required:!0},{field:"role",required:!0},{field:"language",required:!1},{field:"timezone",required:!1},{field:"profession",required:!1}],style:[{field:"tone",required:!0},{field:"brevity",required:!1},{field:"formatting",required:!1},{field:"output_structure",required:!1}],workflow:[{field:"preferred_role",required:!0},{field:"decision_style",required:!1},{field:"recurring_tasks",required:!1}]},Rs=Object.keys(Yt),Os=90;function Is(r){return r==null?!0:Object.keys(r).length===0}function As(r,e){if(!r)return!1;let t=r[e];return!(t==null||t===""||Array.isArray(t)&&t.length===0)}var z=class{check(e){let t=0,s=0,n=[],o=[];for(let a of Rs){let d=e[a],l=Yt[a];if(s+=l.length,Is(d)){n.push(a);for(let c of l)c.required&&o.push(`${a}.${c.field}`);continue}for(let c of l)As(d,c.field)?t++:c.required&&o.push(`${a}.${c.field}`)}return{percentage:s===0?0:Math.round(t/s*100),gaps:n,missingFields:o}}checkStaleness(e,t=new Date){let s=[],n=Os*24*60*60*1e3;for(let[o,i]of Object.entries(e)){if(!i)continue;let a=new Date(i);if(isNaN(a.getTime()))continue;t.getTime()-a.getTime()>n&&s.push(o)}return{staleFields:s}}};var Z=class{constructor(e){this.db=e}getProfile(e,t){let s=this.db.prepare("SELECT content_json FROM agent_profiles WHERE scope = ? AND profile_type = ?").get(e,t);if(!s)return null;try{return JSON.parse(s.content_json)}catch{return null}}setProfile(e,t,s){let n=new Date().toISOString(),o=Date.now(),i=JSON.stringify(s);this.db.prepare(`
      INSERT INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch, updated_at, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, profile_type) DO UPDATE SET
        content_json = excluded.content_json,
        updated_at = excluded.updated_at,
        updated_at_epoch = excluded.updated_at_epoch
    `).run(e,t,i,n,o,n,o),p.debug("PERSONA",`Set ${t} profile for scope: ${e}`)}getMergedPersona(e){let t=["agent_soul","user","style","workflow"],s={};for(let n of t){let o=this.getProfile("global",n)||{},i=e?this.getProfile(e,n)||{}:{};s[n]={...o};for(let[a,d]of Object.entries(i))d!=null&&d!==""&&(s[n][a]=d)}return s}detectConflicts(e){if(!e)return[];let t=["user","style","workflow"],s=[];for(let n of t){let o=this.getProfile("global",n),i=this.getProfile(e,n);if(!(!o||!i))for(let a of Object.keys(i)){let d=o[a],l=i[a];d==null||d===""||l==null||l===""||JSON.stringify(d)!==JSON.stringify(l)&&s.push({profile_type:n,field:a,global_value:d,project_value:l})}}return s}resolveConflict(e,t,s,n,o){let i=this.getProfile("global",t)||{},a=this.getProfile(e,t)||{};switch(n){case"keep_global":{delete a[s],this.setProfile(e,t,a);break}case"keep_project":{i[s]=a[s],this.setProfile("global",t,i);break}case"custom":{i[s]=o,a[s]=o,this.setProfile("global",t,i),this.setProfile(e,t,a);break}}p.debug("PERSONA",`Resolved conflict: ${t}.${s} via ${n} for project ${e}`)}getBootstrapStatus(e){return this.db.prepare("SELECT * FROM bootstrap_state WHERE scope = ?").get(e)||null}updateBootstrapStatus(e,t,s,n){let o=new Date().toISOString();if(this.getBootstrapStatus(e)){let a=["status = ?"],d=[t];s!==void 0&&(a.push("round = ?"),d.push(s)),n&&(a.push("metadata_json = ?"),d.push(JSON.stringify(n))),t==="completed"&&(a.push("completed_at = ?"),d.push(o)),d.push(e),this.db.prepare(`UPDATE bootstrap_state SET ${a.join(", ")} WHERE scope = ?`).run(...d)}else this.db.prepare(`
        INSERT INTO bootstrap_state (scope, status, round, started_at, metadata_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(e,t,s||0,o,n?JSON.stringify(n):null);p.debug("PERSONA",`Bootstrap status for ${e}: ${t}`)}getActiveTask(e){return this.db.prepare("SELECT * FROM active_tasks WHERE project = ? AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 1").get(e)||null}setActiveTask(e,t){let s=new Date().toISOString(),n=Date.now();this.db.prepare("UPDATE active_tasks SET status = 'completed', updated_at = ?, updated_at_epoch = ? WHERE project = ? AND status IN ('in_progress', 'blocked')").run(s,n,e),this.db.prepare(`
      INSERT INTO active_tasks (project, task_name, status, progress, next_step, context_json, interrupted_tasks_json, started_at, started_at_epoch, updated_at, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t.task_name,t.status||"in_progress",t.progress||null,t.next_step||null,t.context_json?JSON.stringify(t.context_json):null,t.interrupted_tasks_json?JSON.stringify(t.interrupted_tasks_json):null,s,n,s,n),p.debug("PERSONA",`Set active task for ${e}: ${t.task_name}`)}updateActiveTask(e,t){let s=new Date().toISOString(),n=Date.now(),o=["updated_at = ?","updated_at_epoch = ?"],i=[s,n];t.status&&(o.push("status = ?"),i.push(t.status)),t.progress&&(o.push("progress = ?"),i.push(t.progress)),t.next_step&&(o.push("next_step = ?"),i.push(t.next_step)),t.context_json&&(o.push("context_json = ?"),i.push(JSON.stringify(t.context_json))),t.interrupted_tasks_json&&(o.push("interrupted_tasks_json = ?"),i.push(JSON.stringify(t.interrupted_tasks_json))),i.push(e),this.db.prepare(`UPDATE active_tasks SET ${o.join(", ")} WHERE project = ? AND status IN ('in_progress', 'blocked')`).run(...i)}completeActiveTask(e){let t=new Date().toISOString(),s=Date.now();this.db.prepare("UPDATE active_tasks SET status = 'completed', updated_at = ?, updated_at_epoch = ? WHERE project = ? AND status IN ('in_progress', 'blocked')").run(t,s,e),p.debug("PERSONA",`Completed active task for ${e}`)}getTaskCheckpoints(e){let t=this.getActiveTask(e);if(!t||!t.context_json)return[];try{let s=JSON.parse(t.context_json);return Array.isArray(s.checkpoints)?s.checkpoints:[]}catch{return[]}}setCheckpoints(e,t){let s=this.getActiveTask(e);if(!s)return;let n={};if(s.context_json)try{n=JSON.parse(s.context_json)}catch{n={}}this.updateActiveTask(e,{context_json:{...n,checkpoints:t}}),p.debug("PERSONA",`Set ${t.length} checkpoints for ${e}`)}addCheckpoint(e,t){let s=this.getTaskCheckpoints(e),n={name:t,status:s.length===0?"in_progress":"pending"};s.push(n),this.setCheckpoints(e,s),p.debug("PERSONA",`Added checkpoint "${t}" for ${e}`)}completeCheckpoint(e,t){let s=this.getTaskCheckpoints(e),n=s.findIndex(u=>u.name===t);if(n===-1)return;s[n].status="completed",s[n].completed_at=new Date().toISOString();let o=s.find(u=>u.status==="pending");o&&(o.status="in_progress");let i=s.filter(u=>u.status==="completed").length,a=s.length,d=o?.name,l=d?`Step ${i+1}/${a}: ${d}`:`Step ${i}/${a}: All complete`,c=this.getActiveTask(e);if(!c)return;let _={};if(c.context_json)try{_=JSON.parse(c.context_json)}catch{_={}}this.updateActiveTask(e,{progress:l,context_json:{..._,checkpoints:s}}),p.debug("PERSONA",`Completed checkpoint "${t}" for ${e}`)}checkCompleteness(e){let t=this.getMergedPersona(e);return new z().check(t)}checkStaleness(e){let t=new z,s=this.db.prepare("SELECT profile_type, updated_at FROM agent_profiles WHERE scope = ? OR scope = 'global'").all(e),n={};for(let o of s)n[o.profile_type]=o.updated_at;return t.checkStaleness(n)}getProjectSchema(e){let t=this.db.prepare("SELECT content_json FROM agent_profiles WHERE scope = ? AND profile_type = 'project_schema'").get(e);if(!t)return null;try{return JSON.parse(t.content_json)}catch{return null}}setProjectSchema(e,t){let s=new Date().toISOString();this.db.prepare("INSERT OR REPLACE INTO agent_profiles (scope, profile_type, content_json, updated_at) VALUES (?, 'project_schema', ?, ?)").run(e,JSON.stringify(t),s),p.debug("PERSONA",`Set project_schema for scope: ${e}`)}};var $=require("fs"),ge=require("path"),Vt=require("crypto");function Ls(r){return(0,Vt.createHash)("sha256").update(r,"utf-8").digest("hex")}function vs(r){let e=r.split(`
`);if(e[0]?.trim()!=="---")return null;let t=-1;for(let i=1;i<e.length;i++)if(e[i].trim()==="---"){t=i;break}if(t===-1)return null;let s=e.slice(1,t),n={};for(let i of s){let a=i.indexOf(":");if(a===-1)continue;let d=i.slice(0,a).trim(),l=i.slice(a+1).trim();d==="name"?n.name=l:d==="description"?n.description=l:d==="type"&&(n.type=l)}let o=e.slice(t+1).join(`
`).trim();return{frontmatter:n,body:o}}var Te=class{constructor(e,t){this.db=e;this.memoryDir=t}syncIncremental(){return this.runSync(!1)}fullImport(){return this.db.prepare("DELETE FROM sync_state").run(),this.runSync(!0)}runSync(e){let t={imported:0,skipped:0,errors:[]};if(p.debug(`AutoMemorySync.runSync: memoryDir=${this.memoryDir} force=${e}`),!(0,$.existsSync)(this.memoryDir))return t;let s;try{s=(0,$.readdirSync)(this.memoryDir).filter(n=>(0,ge.extname)(n)===".md")}catch(n){return t.errors.push(`Failed to read memoryDir: ${String(n)}`),t}for(let n of s){let o=(0,ge.join)(this.memoryDir,n),i;try{i=(0,$.readFileSync)(o,"utf-8")}catch(u){t.errors.push(`Failed to read ${n}: ${String(u)}`);continue}let a=Ls(i);if(!e){let u=this.db.prepare("SELECT content_hash FROM sync_state WHERE file_path = ?").get(o);if(u&&u.content_hash===a){t.skipped++;continue}}let d=vs(i);if(!d){t.skipped++;continue}let{frontmatter:l,body:c}=d,_=l.type;if(_==="user")try{this.upsertUserProfile(c),this.upsertSyncState(o,a,"user"),t.imported++}catch(u){t.errors.push(`Failed to sync user file ${n}: ${String(u)}`)}else if(_==="feedback")try{this.insertFeedbackObservation(l.name,c),this.upsertSyncState(o,a,"feedback"),t.imported++}catch(u){t.errors.push(`Failed to sync feedback file ${n}: ${String(u)}`)}else t.skipped++}return t}upsertUserProfile(e){let t=new Date().toISOString(),s=Date.now(),n=JSON.stringify({raw:e});this.db.prepare(`
      INSERT INTO agent_profiles
        (scope, profile_type, content_json, created_at, created_at_epoch, updated_at, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, profile_type) DO UPDATE SET
        content_json = excluded.content_json,
        updated_at = excluded.updated_at,
        updated_at_epoch = excluded.updated_at_epoch
    `).run("global","user",n,t,s,t,s)}insertFeedbackObservation(e,t){let s=new Date().toISOString(),n=Date.now();this.db.prepare(`
      INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash,
         confidence, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("auto-memory","","feedback",e??null,null,"[]",t,"[]","[]","[]",null,0,null,"high",s,n)}upsertSyncState(e,t,s){let n=new Date().toISOString();this.db.prepare(`
      INSERT INTO sync_state (file_path, content_hash, source_type, last_sync_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        content_hash = excluded.content_hash,
        source_type = excluded.source_type,
        last_sync_at = excluded.last_sync_at
    `).run(e,t,s,n)}};var qt=require("crypto"),j=require("fs"),X=W(require("path"),1),fe=class{constructor(e,t){this.db=e;this.readableDir=t}checkForChanges(){let e=[],t;try{t=this.db.prepare("SELECT file_path, last_db_hash, last_file_hash, last_sync_at FROM markdown_sync").all()}catch{return[]}for(let s of t){let n=this.resolveFilePath(s.file_path);if(!(0,j.existsSync)(n)||this.hashFile(n)===s.last_file_hash)continue;let i=this.classifyFile(s.file_path);if(!i)continue;let a=s.last_db_hash!==s.last_file_hash?"conflict":"updated";e.push({filePath:s.file_path,type:i,action:a})}return e}importChanges(e){let t=0;for(let s of e){if(s.action==="conflict")continue;let n=this.resolveFilePath(s.filePath);if(!(0,j.existsSync)(n))continue;let o=(0,j.readFileSync)(n,"utf8"),i=this.hashContent(o);try{s.type==="profile"?this.importProfile(s.filePath,o):s.type==="knowledge"&&this.importKnowledge(s.filePath,o),this.db.prepare("UPDATE markdown_sync SET last_db_hash = ?, last_file_hash = ?, last_sync_at = ? WHERE file_path = ?").run(i,i,new Date().toISOString(),s.filePath),t++}catch{}}return t}importProfile(e,t){let n=X.basename(e,".md").replace(/-/g,"_"),o={},i=null,a=[];for(let _ of t.split(`
`))_.startsWith("# ")||_.startsWith("> ")||(_.startsWith("## ")?(i!==null&&(o[i]=a.length===1?a[0]:a),i=_.substring(3).trim().toLowerCase().replace(/\s+/g,"_"),a=[]):_.startsWith("- ")&&i?a.push(_.substring(2).trim()):_.trim()&&i&&!_.startsWith("#")&&a.push(_.trim()));if(i!==null&&(o[i]=a.length===1?a[0]:a),Object.keys(o).length===0)return;let d=t.match(/Scope:\s*`([^`]+)`/),l=d?d[1]:"global",c=JSON.stringify(o);this.db.prepare(`
      UPDATE agent_profiles SET content_json = ?, updated_at = ?
      WHERE scope = ? AND profile_type = ?
    `).run(c,new Date().toISOString(),l,n)}importKnowledge(e,t){if(X.basename(e,".md")==="index")return;let n=t.match(/^#\s+(.+)/m);if(!n)return;let o=n[1].trim(),i=t.split(`
`),a=[],d=!1;for(let c of i){if(c.startsWith("# ")&&!d){d=!0;continue}c.startsWith("> ")&&!a.length||d&&a.push(c)}let l=a.join(`
`).trim();l&&this.db.prepare(`
      UPDATE compiled_knowledge SET content = ?, compiled_at = ?
      WHERE topic = ?
    `).run(l,new Date().toISOString(),o)}classifyFile(e){return e.includes("/profile/")||e.includes("\\profile\\")?"profile":e.includes("/knowledge/")||e.includes("\\knowledge\\")?"knowledge":null}resolveFilePath(e){return X.isAbsolute(e)?e:X.join(this.readableDir,e)}hashFile(e){let t=(0,j.readFileSync)(e,"utf8");return this.hashContent(t)}hashContent(e){return(0,qt.createHash)("sha256").update(e).digest("hex")}};var he=class{constructor(e){this.db=e}saveCheckpoint(e,t,s){let n=new Date().toISOString(),o=Date.now(),i=this.db.prepare("SELECT id, context_json FROM active_tasks WHERE project = ? AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 1").get(e);if(i){let a={};if(i.context_json)try{a=JSON.parse(i.context_json)}catch{}a.session_checkpoint=s,this.db.prepare(`UPDATE active_tasks SET
          task_name = ?,
          context_json = ?,
          status = 'in_progress',
          updated_at = ?,
          updated_at_epoch = ?
        WHERE id = ?`).run(s.currentTask,JSON.stringify(a),n,o,i.id)}else{let a=JSON.stringify({session_checkpoint:s});this.db.prepare(`
        INSERT INTO active_tasks (project, task_name, status, context_json, started_at, started_at_epoch, updated_at, updated_at_epoch)
        VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?)
      `).run(e,s.currentTask,a,n,o,n,o)}p.debug("CHECKPOINT",`Saved checkpoint for ${e}: ${s.currentTask} (${s.observationCount} obs)`)}getLatestCheckpoint(e){let t=this.db.prepare("SELECT context_json FROM active_tasks WHERE project = ? AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 1").get(e);if(!t||!t.context_json)return null;try{return JSON.parse(t.context_json).session_checkpoint||null}catch{return null}}buildCheckpointFromObservations(e,t,s,n){let o=n?n.substring(0,100):`Working on ${e}`,i=new Set,a=new Set;for(let f of s){if(f.files_modified){let T=typeof f.files_modified=="string"?Xe(f.files_modified):f.files_modified;Array.isArray(T)&&T.forEach(m=>i.add(m))}if(f.files_read){let T=typeof f.files_read=="string"?Xe(f.files_read):f.files_read;Array.isArray(T)&&T.forEach(m=>a.add(m))}}let d=null;for(let f=s.length-1;f>=0;f--){let T=s[f],m=[T.title,T.narrative,T.facts].filter(Boolean).join(" ").toLowerCase();if(m.includes("test")&&(m.includes("pass")||m.includes("fail"))){let N=m.match(/(\d+)\s*(?:tests?\s+)?pass/),h=m.match(/(\d+)\s*(?:tests?\s+)?fail/),R=[];N&&R.push(`${N[1]} pass`),h&&R.push(`${h[1]} fail`),R.length>0?d=R.join(", "):d=m.includes("fail")?"tests failing":"tests passing";break}}let l=[],c=/\b(TODO|not yet|incomplete|WIP|work.in.progress|unfinished|remaining|still need)\b/i;for(let f of s){let T=f.narrative||"";if(c.test(T)){let m=f.title||T.substring(0,80);l.push(m)}}let _=s[s.length-1],u=_?_.title||_.subtitle||"Unknown action":"No actions recorded",g=Cs(u,l);return{currentTask:o,filesModified:Array.from(i),filesRead:Array.from(a),testStatus:d,pendingWork:l,lastToolAction:u,observationCount:s.length,resumeHint:g,savedAt:new Date().toISOString(),taskHistory:[],conversationTopics:[]}}buildSmartCheckpoint(e,t,s,n,o){let i=this.buildCheckpointFromObservations(e,t,s,n.length>0&&n[n.length-1]?.prompt_text||null);if(n.length>0){let l=n[n.length-1],c=ee(l.prompt_text||"");i.currentTask=c.substring(0,120)||i.currentTask}let a=[];for(let l=0;l<n.length;l++){let c=n[l],_=ee(c.prompt_text||"");if(!_)continue;let u=l===n.length-1,g=c.created_at_epoch||0,f=s.some(m=>{if((m.created_at_epoch||0)<=g)return!1;let h=(m.type||"").toLowerCase(),R=(m.narrative||"").toLowerCase(),P=(m.title||"").toLowerCase();return h==="feature"||h==="bugfix"||/\b(completed|fixed|implemented|added|created|resolved|finished|done)\b/.test(R)||/\b(completed|fixed|implemented|added|created|resolved|finished|done)\b/.test(P)}),T;u&&!f?T="pending":f?T="completed":T="unknown",a.push({prompt:_.substring(0,100),status:T,timestamp:c.created_at||new Date().toISOString()})}if(i.taskHistory=a,n.length>0){let l=n[n.length-1],c=l.created_at_epoch||0;if(!s.some(u=>(u.created_at_epoch||0)>c)){let u=ee(l.prompt_text||"");u&&!i.pendingWork.some(g=>g.toLowerCase().includes(u.substring(0,30).toLowerCase()))&&i.pendingWork.push(`Unfinished: ${u.substring(0,80)}`)}}if(i.testStatus&&/fail/i.test(i.testStatus)){let l=s.filter(c=>{let _=[c.title,c.narrative].filter(Boolean).join(" ").toLowerCase();return _.includes("test")&&_.includes("fail")});for(let c of l){let _=c.files_modified||c.files_read||"",u=typeof _=="string"?Xe(_)[0]:Array.isArray(_)?_[0]:"";u&&!i.pendingWork.some(g=>g.includes(u))&&i.pendingWork.push(`Fix failing tests in ${u}`)}}i.resumeHint=ys(i,n,s);let d=new Set;for(let l of n){let c=l.prompt_text||"",_=ee(c);if(_){let u=_.split(/[.!?\n]/)[0]?.trim();u&&u.length>3&&d.add(u.substring(0,60))}}return i.conversationTopics=Array.from(d),i}clearCheckpoint(e){let t=this.db.prepare("SELECT id, context_json FROM active_tasks WHERE project = ? AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 1").get(e);if(t){if(t.context_json)try{let s=JSON.parse(t.context_json);delete s.session_checkpoint;let n=new Date().toISOString(),o=Date.now();this.db.prepare("UPDATE active_tasks SET context_json = ?, updated_at = ?, updated_at_epoch = ? WHERE id = ?").run(JSON.stringify(s),n,o,t.id)}catch{}p.debug("CHECKPOINT",`Cleared checkpoint for ${e}`)}}};function Xe(r){try{let e=JSON.parse(r);if(Array.isArray(e))return e}catch{}return r.split(",").map(e=>e.trim()).filter(Boolean)}function Cs(r,e){let t=[];return r&&r!=="No actions recorded"&&t.push(`Last: ${r}`),e.length>0&&t.push(`Next: ${e[0]}`),t.length===0?"Continue working on the project":t.join(". ")}function ee(r){let e=r.trim(),t="";for(;t!==e;)t=e,e=e.replace(/^(can you|could you|please|help me|i want to|i need to|let's|let us)\s+/i,"");return e=e.replace(/^[,;:\-–—]+\s*/,""),e.trim()}function ys(r,e,t){if(r.testStatus&&/fail/i.test(r.testStatus)){let s=r.filesModified.slice(-1),n=s.length>0?` in ${s[0]}`:"";return`Tests failing (${r.testStatus})${n} \u2014 fix before continuing`}if(e.length>0){let s=e[e.length-1],n=s.created_at_epoch||0;if(!t.some(i=>{if((i.created_at_epoch||0)<=n)return!1;let d=(i.type||"").toLowerCase(),l=(i.narrative||"").toLowerCase();return d==="feature"||d==="bugfix"||/\b(completed|fixed|implemented|finished|done)\b/.test(l)})){let i=ee(s.prompt_text||"");if(i)return`User asked '${i.substring(0,80)}' but it wasn't finished`}}return r.filesModified.length>0?`Last working on ${r.filesModified[r.filesModified.length-1]}`:`Continue from where ${r.currentTask.substring(0,60)} left off`}var Pe=require("fs"),Ds=be.default.join((0,Ne.homedir)(),".claude","plugins","marketplaces","agent-recall","plugin",".install-version");function Ms(){try{return new ie}catch(r){if(r.code==="ERR_DLOPEN_FAILED"){try{(0,Jt.unlinkSync)(Ds)}catch(e){p.debug("SYSTEM","Marker file cleanup failed (may not exist)",{},e)}return p.error("SYSTEM","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw r}}function Kt(r,e,t){let s=e?kt(r):bt(r);return!t||t.status!=="completed"?s+(e?`
\x1B[33m\x1B[1m\u2605 Welcome to Agent Recall!\x1B[0m
\x1B[33mRun /bootstrap to set up your agent persona and preferences.\x1B[0m
\x1B[2mThis creates a persistent identity that carries across sessions.\x1B[0m
`:`
**Welcome to Agent Recall!** Run /bootstrap to set up your agent persona and preferences.
This creates a persistent identity that carries across sessions.
`):s}function Us(r,e,t,s,n,o,i,a,d,l,c,_,u,g,f){let T=[];if(a){let b=we(a,i);if(T.push(...b),c){let I=b.join(`
`);c.consume("L0",L.estimateTokens(I))}}let m=Wt(i);if(T.push(...m),c){let b=m.join(`
`);c.consume("L0",L.estimateTokens(b))}if(l&&l.length>0){let b=`\u26A0 Persona conflicts detected (${l.length} field${l.length>1?"s":""} differ between global and project). Use /api/persona/conflicts?project=${encodeURIComponent(r)} to review.`;T.push(b,"")}if(d){let b=Fe(d,i),I=b.join(`
`),S=L.estimateTokens(I);(!c||c.canFit("L1",S))&&(T.push(...b),c&&c.consume("L1",S))}if(f){let b=i?["\x1B[33m\x1B[1m> Warning: Your last session was interrupted (terminal closed unexpectedly).\x1B[0m","\x1B[33m> Observations were recovered. Check the checkpoint above for where you left off.\x1B[0m",""]:["> **Warning:** Your last session was interrupted (terminal closed unexpectedly).","> Observations were recovered. Check the checkpoint above for where you left off.",""];T.push(...b)}if(g&&!d){let b=[`> **Last session checkpoint** (${g.savedAt}):`,`> Task: ${g.currentTask}`,g.testStatus?`> Tests: ${g.testStatus}`:null,g.pendingWork.length>0?`> Pending: ${g.pendingWork.join(", ")}`:null,g.resumeHint?`> Resume: ${g.resumeHint}`:null].filter(Boolean);if(g.taskHistory&&g.taskHistory.length>0){let C=g.taskHistory.filter(M=>M.status==="pending"),y=g.taskHistory.filter(M=>M.status==="completed");y.length>0&&b.push(`> Completed: ${y.map(M=>M.prompt).join("; ")}`),C.length>0&&b.push(`> Still pending: ${C.map(M=>M.prompt).join("; ")}`)}b.push("");let I=b.join(`
`),S=L.estimateTokens(I);(!c||c.canFit("L1",S))&&(T.push(...b),c&&c.consume("L1",S))}if(_&&_.length>0&&T.push(..._),!d&&t.length>0){let b=!1;if(t[0].structured_summary)try{let I=JSON.parse(t[0].structured_summary);if(I.resumeContext&&I.resumeContext!=="No specific resume context available."){let S=[];i?S.push("\x1B[33m\x1B[1m\u25C6 Session Resume Context:\x1B[0m"):S.push("> **Session Resume Context:**");for(let M of I.resumeContext.split(`
`))i?S.push(`\x1B[33m  ${M}\x1B[0m`):S.push(`> ${M}`);S.push("");let C=S.join(`
`),y=L.estimateTokens(C);(!c||c.canFit("L1",y))&&(T.push(...S),c&&c.consume("L1",y),b=!0)}}catch{}if(!b&&t[0].next_steps){let I=t[0].next_steps.trim();if(I){let S;i?S=[`\x1B[33m\u25C6 Last session's next steps:\x1B[0m ${I}`,""]:S=[`**Last session's next steps:** ${I}`,""];let C=S.join(`
`),y=L.estimateTokens(C);(!c||c.canFit("L1",y))&&(T.push(...S),c&&c.consume("L1",y))}}}let N=Le(e);if(T.push(...xt(r,N,s,i)),u&&u.length>0){let I=u.map(C=>`### ${C.topic}
${C.content}`).join(`

`),S=L.estimateTokens(I);c&&c.canFit("L2",S)&&(T.push(`
## Project Knowledge
`),T.push(I),c.consume("L2",S))}let h=e;if(c){let b=c.remaining("L2"),I=0;h=e.filter(S=>{let C=[S.title,S.narrative,S.facts?JSON.stringify(S.facts):null].filter(Boolean).join(" "),y=L.estimateTokens(C);return I+y<=b?(I+=y,!0):!1})}let R=t.slice(0,s.sessionCount),P=ot(R,t),A=Me(h,P),x=it(h,s.fullObservationCount);T.push(...Gt(A,x,s,n,i,!0));let B=t[0],w=h[0];$t(s,B,w)&&T.push(...jt(B,i));let H=De(h,s,o,n);return T.push(...Bt(H,i)),T.push(...Ht(N,s,i)),T.join(`
`).trimEnd()}async function Ge(r,e=!1){let t=Oe(),s=r?.cwd??process.cwd(),n=ze(s),o=r?.globalMode??Qe(s),i=r?.projects||[n];r?.full&&(t.totalObservationCount=999999,t.sessionCount=999999);let a=Ms();if(!a)return"";try{let d=be.default.join((0,Ne.homedir)(),".claude","memory");if((0,Pe.existsSync)(d)){let c=new Te(a.db,d).syncIncremental();c.imported>0&&p.debug("CONTEXT",`Auto memory sync: imported ${c.imported} entries`)}}catch(d){p.debug("CONTEXT","Auto memory sync failed (non-blocking)",{error:String(d)})}try{let d=be.default.join((0,Ne.homedir)(),".agent-recall","readable");if((0,Pe.existsSync)(d)){let l=new fe(a.db,d),c=l.checkForChanges();if(c.length>0){let _=l.importChanges(c);_>0&&p.debug("CONTEXT",`Markdown import: imported ${_} user-edited files`)}}}catch(d){p.debug("CONTEXT","Markdown import check failed (non-blocking)",{error:String(d)})}try{if(o){p.debug("CONTEXT","Global Quick Mode \u2014 skipping project-specific context",{cwd:s,project:n});let A=null,x=null,B=null;try{let b=new Z(a.db);A=b.getMergedPersona("__global__"),B=b.getBootstrapStatus("__global__"),x=b.getActiveTask(n)}catch(b){p.debug("CONTEXT","Persona query skipped in global mode (tables may not exist yet)",{},b)}let w=[],H=new L(t.tokenBudget||3e3);if(e?w.push("\x1B[36m\x1B[1m\u25CF Global Mode\x1B[0m \x1B[2m\u2014 launched from home directory\x1B[0m",""):w.push("**Global Mode** \u2014 launched from home directory",""),A){let b=we(A,e);w.push(...b);let I=b.join(`
`);H.consume("L0",L.estimateTokens(I))}if(x){let b=Fe(x,e),I=b.join(`
`),S=L.estimateTokens(I);H.canFit("L1",S)&&(w.push(...b),H.consume("L1",S))}if(!A?.agent_soul?.name){let b=Kt(n,e,B);b&&w.push(b)}return w.join(`
`).trimEnd()}let d=i.length>1?nt(a,i,t):ve(a,n,t),l=i.length>1?rt(a,i,t):Ce(a,n,t),c=null,_=null,u=null,g=[],f=null;try{f=new Z(a.db),c=f.getMergedPersona(n),_=f.getActiveTask(n),u=f.getBootstrapStatus("__global__"),g=f.detectConflicts(n)}catch(A){p.debug("CONTEXT","Persona query skipped (tables may not exist yet)",{},A)}if(d.length===0&&l.length===0&&!c?.agent_soul?.name)return Kt(n,e,u);let T=[];if(u?.status==="completed"&&f)try{let A=f.checkCompleteness(n),x=f.checkStaleness(n);A.percentage<80&&A.gaps.length>0&&T.push(`
> Profile ${A.percentage}% complete. Missing: ${A.gaps.join(", ")}`),x.staleFields.length>0&&T.push(`
> Some profile fields not updated in 90+ days: ${x.staleFields.join(", ")}`)}catch(A){p.debug("CONTEXT","Completeness check failed (non-blocking)",{error:String(A)})}let m=new L(t.tokenBudget||3e3),N=[];try{N=a.getCompiledKnowledge(n)}catch{}let h=null;try{h=new he(a.db).getLatestCheckpoint(n)}catch{}let R=!1;try{a.db.prepare("SELECT status, content_session_id FROM sdk_sessions WHERE project = ? ORDER BY started_at_epoch DESC LIMIT 1").get(n)?.status==="interrupted"&&(R=!0)}catch{}return Us(n,d,l,t,s,r?.session_id,e,c,_,g,m,T,N,h,R)}finally{a.close()}}0&&(module.exports={generateContext});
