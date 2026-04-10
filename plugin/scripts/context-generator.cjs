"use strict";var Gt=Object.create;var V=Object.defineProperty;var jt=Object.getOwnPropertyDescriptor;var Bt=Object.getOwnPropertyNames;var Ht=Object.getPrototypeOf,Wt=Object.prototype.hasOwnProperty;var Yt=(r,e)=>{for(var t in e)V(r,t,{get:e[t],enumerable:!0})},De=(r,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of Bt(e))!Wt.call(r,n)&&n!==t&&V(r,n,{get:()=>e[n],enumerable:!(s=jt(e,n))||s.enumerable});return r};var q=(r,e,t)=>(t=r!=null?Gt(Ht(r)):{},De(e||!r||!r.__esModule?V(t,"default",{value:r,enumerable:!0}):t,r)),Vt=r=>De(V({},"__esModule",{value:!0}),r);var Ss={};Yt(Ss,{generateContext:()=>Ce});module.exports=Vt(Ss);var Le=q(require("path"),1),ve=require("os"),Pt=require("fs");var $e=require("bun:sqlite");var S=require("path"),K=require("os"),$=require("fs");var ke=require("url");var D=require("fs"),P=require("path"),Ue=require("os"),pe=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(pe||{}),Me=(0,P.join)((0,Ue.homedir)(),".agent-recall"),_e=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=(0,P.join)(Me,"logs");(0,D.existsSync)(e)||(0,D.mkdirSync)(e,{recursive:!0});let t=new Date().toISOString().split("T")[0];this.logFilePath=(0,P.join)(e,`claude-mem-${t}.log`)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e),this.logFilePath=null}}}getLevel(){if(this.level===null)try{let e=(0,P.join)(Me,"settings.json");if((0,D.existsSync)(e)){let t=(0,D.readFileSync)(e,"utf-8"),n=(JSON.parse(t).CLAUDE_MEM_LOG_LEVEL||"INFO").toUpperCase();this.level=pe[n]??1}else this.level=1}catch{this.level=1}return this.level}correlationId(e,t){return`obs-${e}-${t}`}sessionId(e){return`session-${e}`}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?JSON.stringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let s=t;if(typeof t=="string")try{s=JSON.parse(t)}catch{s=t}if(e==="Bash"&&s.command)return`${e}(${s.command})`;if(s.file_path)return`${e}(${s.file_path})`;if(s.notebook_path)return`${e}(${s.notebook_path})`;if(e==="Glob"&&s.pattern)return`${e}(${s.pattern})`;if(e==="Grep"&&s.pattern)return`${e}(${s.pattern})`;if(s.url)return`${e}(${s.url})`;if(s.query)return`${e}(${s.query})`;if(e==="Task"){if(s.subagent_type)return`${e}(${s.subagent_type})`;if(s.description)return`${e}(${s.description})`}return e==="Skill"&&s.skill?`${e}(${s.skill})`:e==="LSP"&&s.operation?`${e}(${s.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${s}-${n} ${o}:${i}:${a}.${d}`}log(e,t,s,n,o){if(e<this.getLevel())return;this.ensureLogFileInitialized();let i=this.formatTimestamp(new Date),a=pe[e].padEnd(5),d=t.padEnd(6),p="";n?.correlationId?p=`[${n.correlationId}] `:n?.sessionId&&(p=`[session-${n.sessionId}] `);let E="";o!=null&&(o instanceof Error?E=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`:this.getLevel()===0&&typeof o=="object"?E=`
`+JSON.stringify(o,null,2):E=" "+this.formatData(o));let m="";if(n){let{sessionId:u,memorySessionId:g,correlationId:R,...T}=n;Object.keys(T).length>0&&(m=` {${Object.entries(T).map(([b,N])=>`${b}=${N}`).join(", ")}}`)}let l=`[${i}] [${a}] [${d}] ${p}${s}${m}${E}`;if(this.logFilePath)try{(0,D.appendFileSync)(this.logFilePath,l+`
`,"utf8")}catch(u){process.stderr.write(`[LOGGER] Failed to write to log file: ${u}
`)}else process.stderr.write(l+`
`)}debug(e,t,s,n){this.log(0,e,t,s,n)}info(e,t,s,n){this.log(1,e,t,s,n)}warn(e,t,s,n){this.log(2,e,t,s,n)}error(e,t,s,n){this.log(3,e,t,s,n)}dataIn(e,t,s,n){this.info(e,`\u2192 ${t}`,s,n)}dataOut(e,t,s,n){this.info(e,`\u2190 ${t}`,s,n)}success(e,t,s,n){this.info(e,`\u2713 ${t}`,s,n)}failure(e,t,s,n){this.error(e,`\u2717 ${t}`,s,n)}timing(e,t,s,n){this.info(e,`\u23F1 ${t}`,n,{duration:`${s}ms`})}happyPathError(e,t,s,n,o=""){let p=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),E=p?`${p[1].split("/").pop()}:${p[2]}`:"unknown",m={...s,location:E};return this.warn(e,`[HAPPY-PATH] ${t}`,m,n),o}},c=new _e;var zt={};function qt(){return typeof __dirname<"u"?__dirname:(0,S.dirname)((0,ke.fileURLToPath)(zt.url))}var Kt=qt(),Jt=(0,S.join)((0,K.homedir)(),".claude-mem");function Qt(){if(process.env.AGENT_RECALL_DATA_DIR)return process.env.AGENT_RECALL_DATA_DIR;if(process.env.CLAUDE_MEM_DATA_DIR)return process.env.CLAUDE_MEM_DATA_DIR;let r=(0,S.join)((0,K.homedir)(),".agent-recall"),e=(0,S.join)(r,"settings.json");try{if((0,$.existsSync)(e)){let{readFileSync:s}=require("fs"),n=JSON.parse(s(e,"utf-8")),o=n.env??n;if(o.AGENT_RECALL_DATA_DIR||o.CLAUDE_MEM_DATA_DIR)return o.AGENT_RECALL_DATA_DIR||o.CLAUDE_MEM_DATA_DIR}}catch{}let t=(0,S.join)(Jt,"settings.json");try{if((0,$.existsSync)(t)){let{readFileSync:s}=require("fs"),n=JSON.parse(s(t,"utf-8")),o=n.env??n;if(o.CLAUDE_MEM_DATA_DIR)return o.CLAUDE_MEM_DATA_DIR}}catch{}return r}var v=Qt(),k=process.env.CLAUDE_CONFIG_DIR||(0,S.join)((0,K.homedir)(),".claude"),Ls=(0,S.join)(k,"plugins","marketplaces","agent-recall"),vs=(0,S.join)(k,"plugins","marketplaces","thedotmack"),Cs=(0,S.join)(v,"archives"),ys=(0,S.join)(v,"logs"),Ds=(0,S.join)(v,"trash"),Ms=(0,S.join)(v,"backups"),Us=(0,S.join)(v,"modes"),xe=(0,S.join)(v,"settings.json"),we=(0,S.join)(v,"agent-recall.db");var ks=(0,S.join)(v,"vector-db"),xs=(0,S.join)(v,"observer-sessions"),ws=(0,S.join)(k,"settings.json"),Xs=(0,S.join)(k,"commands"),Fs=(0,S.join)(k,"CLAUDE.md");function Xe(r){(0,$.mkdirSync)(r,{recursive:!0})}function Fe(){return(0,S.join)(Kt,"..")}var Pe=require("crypto");var Zt=3e4;function J(r,e,t){return(0,Pe.createHash)("sha256").update((r||"")+(e||"")+(t||"")).digest("hex").slice(0,16)}function Q(r,e,t){let s=t-Zt;return r.prepare("SELECT id, created_at_epoch FROM observations WHERE content_hash = ? AND created_at_epoch > ?").get(e,s)}var z=class{constructor(e){this.db=e}runAllMigrations(){this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.createAgentRecallCoreTables(),this.addScopeColumns(),this.createSessionArchivesTable(),this.createTemplatesTable(),this.createAuditLogTable(),this.createObservationBufferTable(),this.addObservationPhase1Fields(),this.createSyncStateTable(),this.createCompiledKnowledgeTable(),this.addObservationPhase2Fields(),this.createEntitiesTable(),this.createFactsTable(),this.createAgentDiaryTable(),this.createMarkdownSyncTable(),this.createActivityLogTable()}initializeSchema(){this.db.run(`
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
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(s=>s.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),c.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),c.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),c.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),c.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(s=>s.unique===1)){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}c.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
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
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),c.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}c.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),c.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}c.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
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
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),c.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}c.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
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
      `)}catch(s){c.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},s)}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),c.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),c.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),c.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}c.debug("DB","Creating pending_messages table"),this.db.run(`
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
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),c.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;c.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(E=>E.name===o);return a.some(E=>E.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),c.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(c.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?c.debug("DB",`Successfully renamed ${t} session ID columns`):c.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),c.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21)){c.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
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
        `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),c.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(t){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),t}}}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),c.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),c.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}createAgentRecallCoreTables(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)){c.debug("DB","Creating Agent Recall core tables (agent_profiles, bootstrap_state, active_tasks)"),this.db.run("BEGIN TRANSACTION");try{this.db.run(`
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
      `),this.db.run("CREATE INDEX IF NOT EXISTS idx_active_tasks_project ON active_tasks(project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_active_tasks_status ON active_tasks(status)"),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(24,new Date().toISOString()),c.debug("DB","Agent Recall core tables created successfully")}catch(t){throw this.db.run("ROLLBACK"),t}}}addScopeColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(25))return;this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="scope")||(this.db.run("ALTER TABLE observations ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'"),c.debug("DB","Added scope column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(n=>n.name==="scope")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'"),c.debug("DB","Added scope column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(25,new Date().toISOString())}createSessionArchivesTable(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(26)){c.debug("DB","Creating session_archives and sync_policies tables"),this.db.run("BEGIN TRANSACTION");try{this.db.run(`
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
        `)}catch(t){c.warn("DB","FTS5 not available \u2014 session_archives_fts skipped",{},t)}this.db.run(`
        CREATE TABLE IF NOT EXISTS sync_policies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project TEXT NOT NULL UNIQUE,
          default_action TEXT NOT NULL DEFAULT 'ask',
          created_at TEXT NOT NULL,
          updated_at TEXT
        )
      `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(26,new Date().toISOString()),c.debug("DB","session_archives and sync_policies tables created")}catch(t){throw this.db.run("ROLLBACK"),t}}}createTemplatesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(27))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='templates'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString());return}c.debug("DB","Creating templates table"),this.db.run(`
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
    `),this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_scope_name ON templates(scope, name)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString()),c.debug("DB","templates table created successfully")}createAuditLogTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(28))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString());return}c.debug("DB","Creating audit_log table"),this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        record_count INTEGER,
        performed_at TEXT NOT NULL,
        performed_at_epoch INTEGER NOT NULL
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_audit_log_epoch ON audit_log(performed_at_epoch)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString()),c.debug("DB","audit_log table created successfully")}createObservationBufferTable(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(29)||(this.db.exec(`
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
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(38,new Date().toISOString()),c.debug("DB","activity_log table created successfully"))}};var Z=class{db;constructor(e=we){e!==":memory:"&&Xe(v),this.db=new $e.Database(e),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA foreign_keys = ON"),this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),new z(this.db).runAllMigrations()}initializeSchema(){this.db.run(`
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
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(s=>s.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),c.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),c.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),c.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),c.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(s=>s.unique===1)){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}c.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
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
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),c.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}c.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),c.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}c.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
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
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),c.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}c.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
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
      `)}catch(s){c.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},s)}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),c.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),c.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),c.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}c.debug("DB","Creating pending_messages table"),this.db.run(`
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
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),c.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;c.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(E=>E.name===o);return a.some(E=>E.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),c.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(c.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?c.debug("DB",`Successfully renamed ${t} session ID columns`):c.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),c.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(!this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21)){c.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
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
        `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),c.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(t){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),t}}}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),c.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),c.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}updateMemorySessionId(e,t){this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(t,e)}ensureMemorySessionIdRegistered(e,t){let s=this.db.prepare(`
      SELECT id, memory_session_id FROM sdk_sessions WHERE id = ?
    `).get(e);if(!s)throw new Error(`Session ${e} not found in sdk_sessions`);s.memory_session_id!==t&&(this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(t,e),c.info("DB","Registered memory_session_id before storage (FK fix)",{sessionDbId:e,oldId:s.memory_session_id,newId:t}))}getRecentSummaries(e,t=10){return this.db.prepare(`
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
    `).get(e)}getRecentSessionsWithStatus(e,t=3){return this.db.prepare(`
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
    `).get(e)||null}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,type:i,concepts:a,files:d}=t,p=s==="date_asc"?"ASC":"DESC",E=n?`LIMIT ${n}`:"",m=e.map(()=>"?").join(","),l=[...e],u=[];if(o&&(u.push("project = ?"),l.push(o)),i)if(Array.isArray(i)){let T=i.map(()=>"?").join(",");u.push(`type IN (${T})`),l.push(...i)}else u.push("type = ?"),l.push(i);if(a){let T=Array.isArray(a)?a:[a],f=T.map(()=>"EXISTS (SELECT 1 FROM json_each(concepts) WHERE value = ?)");l.push(...T),u.push(`(${f.join(" OR ")})`)}if(d){let T=Array.isArray(d)?d:[d],f=T.map(()=>"(EXISTS (SELECT 1 FROM json_each(files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(files_modified) WHERE value LIKE ?))");T.forEach(b=>{l.push(`%${b}%`,`%${b}%`)}),u.push(`(${f.join(" OR ")})`)}let g=u.length>0?`WHERE id IN (${m}) AND ${u.join(" AND ")}`:`WHERE id IN (${m})`;return this.db.prepare(`
      SELECT *
      FROM observations
      ${g}
      ORDER BY created_at_epoch ${p}
      ${E}
    `).all(...l)}getSummaryForSession(e){return this.db.prepare(`
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
    `).get(e,t)?.prompt_text??null}storeObservation(e,t,s,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),p=J(e,s.title,s.narrative),E=Q(this.db,p,a);if(E)return{id:E.id,createdAtEpoch:E.created_at_epoch};let l=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch,
       confidence, tags, has_preference, event_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.type,s.title,s.subtitle,JSON.stringify(s.facts),s.narrative,JSON.stringify(s.concepts),JSON.stringify(s.files_read),JSON.stringify(s.files_modified),n||null,o,p,d,a,s.confidence||"medium",JSON.stringify(s.tags||[]),s.has_preference?1:0,s.event_date||null);return{id:Number(l.lastInsertRowid),createdAtEpoch:a}}storeSummary(e,t,s,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),E=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.request,s.investigated,s.learned,s.completed,s.next_steps,s.notes,n||null,o,d,a);return{id:Number(E.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,t,s,n,o,i=0,a){let d=a??Date.now(),p=new Date(d).toISOString();return this.db.transaction(()=>{let m=[],l=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch,
         confidence, tags, has_preference, event_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);for(let g of s){let R=J(e,g.title,g.narrative),T=Q(this.db,R,d);if(T){m.push(T.id);continue}let f=l.run(e,t,g.type,g.title,g.subtitle,JSON.stringify(g.facts),g.narrative,JSON.stringify(g.concepts),JSON.stringify(g.files_read),JSON.stringify(g.files_modified),o||null,i,R,p,d,g.confidence||"medium",JSON.stringify(g.tags||[]),g.has_preference?1:0,g.event_date||null);m.push(Number(f.lastInsertRowid))}let u=null;if(n){let R=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,o||null,i,p,d);u=Number(R.lastInsertRowid)}return{observationIds:m,summaryId:u,createdAtEpoch:d}})()}storeObservationsAndMarkComplete(e,t,s,n,o,i,a,d=0,p){let E=p??Date.now(),m=new Date(E).toISOString();return this.db.transaction(()=>{let u=[],g=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch,
         confidence, tags, has_preference, event_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);for(let f of s){let b=J(e,f.title,f.narrative),N=Q(this.db,b,E);if(N){u.push(N.id);continue}let C=g.run(e,t,f.type,f.title,f.subtitle,JSON.stringify(f.facts),f.narrative,JSON.stringify(f.concepts),JSON.stringify(f.files_read),JSON.stringify(f.files_modified),a||null,d,b,m,E,f.confidence||"medium",JSON.stringify(f.tags||[]),f.has_preference?1:0,f.event_date||null);u.push(Number(C.lastInsertRowid))}let R;if(n){let b=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,a||null,d,m,E);R=Number(b.lastInsertRowid)}return this.db.prepare(`
        UPDATE pending_messages
        SET
          status = 'processed',
          completed_at_epoch = ?,
          tool_input = NULL,
          tool_response = NULL
        WHERE id = ? AND status = 'processing'
      `).run(E,o),{observationIds:u,summaryId:R,createdAtEpoch:E}})()}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o}=t,i=s==="date_asc"?"ASC":"DESC",a=n?`LIMIT ${n}`:"",d=e.map(()=>"?").join(","),p=[...e],E=o?`WHERE id IN (${d}) AND project = ?`:`WHERE id IN (${d})`;return o&&p.push(o),this.db.prepare(`
      SELECT * FROM session_summaries
      ${E}
      ORDER BY created_at_epoch ${i}
      ${a}
    `).all(...p)}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o}=t,i=s==="date_asc"?"ASC":"DESC",a=n?`LIMIT ${n}`:"",d=e.map(()=>"?").join(","),p=[...e],E=o?"AND s.project = ?":"";return o&&p.push(o),this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.id IN (${d}) ${E}
      ORDER BY up.created_at_epoch ${i}
      ${a}
    `).all(...p)}getTimelineAroundTimestamp(e,t=10,s=10,n){return this.getTimelineAroundObservation(null,e,t,s,n)}getTimelineAroundObservation(e,t,s=10,n=10,o){let i=o?"AND project = ?":"",a=o?[o]:[],d,p;if(e!==null){let T=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id <= ? ${i}
        ORDER BY id DESC
        LIMIT ?
      `,f=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id >= ? ${i}
        ORDER BY id ASC
        LIMIT ?
      `;try{let b=this.db.prepare(T).all(e,...a,s+1),N=this.db.prepare(f).all(e,...a,n+1);if(b.length===0&&N.length===0)return{observations:[],sessions:[],prompts:[]};d=b.length>0?b[b.length-1].created_at_epoch:t,p=N.length>0?N[N.length-1].created_at_epoch:t}catch(b){return c.error("DB","Error getting boundary observations",void 0,{error:b,project:o}),{observations:[],sessions:[],prompts:[]}}}else{let T=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch <= ? ${i}
        ORDER BY created_at_epoch DESC
        LIMIT ?
      `,f=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch >= ? ${i}
        ORDER BY created_at_epoch ASC
        LIMIT ?
      `;try{let b=this.db.prepare(T).all(t,...a,s),N=this.db.prepare(f).all(t,...a,n+1);if(b.length===0&&N.length===0)return{observations:[],sessions:[],prompts:[]};d=b.length>0?b[b.length-1].created_at_epoch:t,p=N.length>0?N[N.length-1].created_at_epoch:t}catch(b){return c.error("DB","Error getting boundary timestamps",void 0,{error:b,project:o}),{observations:[],sessions:[],prompts:[]}}}let E=`
      SELECT *
      FROM observations
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,m=`
      SELECT *
      FROM session_summaries
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,l=`
      SELECT up.*, s.project, s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${i.replace("project","s.project")}
      ORDER BY up.created_at_epoch ASC
    `,u=this.db.prepare(E).all(d,p,...a),g=this.db.prepare(m).all(d,p,...a),R=this.db.prepare(l).all(d,p,...a);return{observations:u,sessions:g.map(T=>({id:T.id,memory_session_id:T.memory_session_id,project:T.project,request:T.request,completed:T.completed,next_steps:T.next_steps,created_at:T.created_at,created_at_epoch:T.created_at_epoch})),prompts:R.map(T=>({id:T.id,content_session_id:T.content_session_id,prompt_number:T.prompt_number,prompt_text:T.prompt_text,project:T.project,created_at:T.created_at,created_at_epoch:T.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
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
    `).run(t,s,e,o.toISOString(),o.getTime()),c.info("SESSION","Created manual session",{memorySessionId:t,project:e}),t}getCompiledKnowledge(e){return this.db.prepare("SELECT * FROM compiled_knowledge WHERE project = ? AND valid_until IS NULL ORDER BY compiled_at DESC").all(e)}getCompiledKnowledgeByTopic(e,t){return this.db.prepare("SELECT * FROM compiled_knowledge WHERE project = ? AND topic = ? AND valid_until IS NULL ORDER BY version DESC LIMIT 1").get(e,t)||null}upsertCompiledKnowledge(e,t,s,n,o="high"){let i=this.getCompiledKnowledgeByTopic(e,t),a=new Date().toISOString();if(i)return this.db.prepare("UPDATE compiled_knowledge SET content = ?, source_observation_ids = ?, confidence = ?, version = version + 1, compiled_at = ? WHERE id = ?").run(s,JSON.stringify(n),o,a,i.id),i.id;{let d=this.db.prepare("INSERT INTO compiled_knowledge (project, topic, content, source_observation_ids, confidence, compiled_at) VALUES (?, ?, ?, ?, ?, ?)").run(e,t,s,JSON.stringify(n),o,a);return Number(d.lastInsertRowid)}}getObservationsSinceEpoch(e,t){return this.db.prepare("SELECT * FROM observations WHERE project = ? AND created_at_epoch > ? ORDER BY created_at_epoch ASC").all(e,t)}close(){this.db.close()}importSdkSession(e){let t=this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e.content_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
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
    `).run(e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}updateLastReferenced(e){if(e.length===0)return;let t=new Date().toISOString(),s=e.map(()=>"?").join(",");this.db.prepare(`UPDATE observations SET last_referenced_at = ? WHERE id IN (${s})`).run(t,...e)}};var ee=q(require("path"),1);function Ge(r){let e=process.env.HOME||process.env.USERPROFILE||"";return e?ee.default.resolve(r)===ee.default.resolve(e):!1}function je(r){if(!r||r.trim()==="")return c.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:r}),"unknown-project";let e=ee.default.basename(r);if(e===""){if(process.platform==="win32"){let s=r.match(/^([A-Z]):\\/i);if(s){let o=`drive-${s[1].toUpperCase()}`;return c.info("PROJECT_NAME","Drive root detected",{cwd:r,projectName:o}),o}}return c.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:r}),"unknown-project"}return e}var y=require("fs"),se=require("path"),Be=require("os"),te=class{static DEFAULTS={CLAUDE_MEM_MODEL:"claude-sonnet-4-5",CLAUDE_MEM_CONTEXT_OBSERVATIONS:"50",CLAUDE_MEM_WORKER_PORT:"37777",CLAUDE_MEM_WORKER_HOST:"127.0.0.1",CLAUDE_MEM_SKIP_TOOLS:"ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion",CLAUDE_MEM_PROVIDER:"claude",CLAUDE_MEM_CLAUDE_AUTH_METHOD:"cli",CLAUDE_MEM_GEMINI_API_KEY:"",CLAUDE_MEM_GEMINI_MODEL:"gemini-2.5-flash-lite",CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED:"true",CLAUDE_MEM_OPENROUTER_API_KEY:"",CLAUDE_MEM_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",CLAUDE_MEM_OPENROUTER_SITE_URL:"",CLAUDE_MEM_OPENROUTER_APP_NAME:"agent-recall",CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_OPENROUTER_MAX_TOKENS:"100000",CLAUDE_MEM_DATA_DIR:(0,se.join)((0,Be.homedir)(),".agent-recall"),CLAUDE_MEM_LOG_LEVEL:"INFO",CLAUDE_MEM_PYTHON_VERSION:"3.13",CLAUDE_CODE_PATH:"",CLAUDE_MEM_MODE:"code",CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT:"true",CLAUDE_MEM_CONTEXT_FULL_COUNT:"0",CLAUDE_MEM_CONTEXT_FULL_FIELD:"narrative",CLAUDE_MEM_CONTEXT_SESSION_COUNT:"10",CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY:"true",CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE:"false",CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED:"false",CLAUDE_MEM_MAX_CONCURRENT_AGENTS:"2",CLAUDE_MEM_RATE_LIMIT_PAUSE_SECONDS:"300",CLAUDE_MEM_EXCLUDED_PROJECTS:"",CLAUDE_MEM_FOLDER_MD_EXCLUDE:"[]",CLAUDE_MEM_CHROMA_ENABLED:"false",CLAUDE_MEM_CHROMA_MODE:"local",CLAUDE_MEM_CHROMA_HOST:"127.0.0.1",CLAUDE_MEM_CHROMA_PORT:"8000",CLAUDE_MEM_CHROMA_SSL:"false",CLAUDE_MEM_CHROMA_API_KEY:"",CLAUDE_MEM_CHROMA_TENANT:"default_tenant",CLAUDE_MEM_CHROMA_DATABASE:"default_database",CLAUDE_MEM_DATA_RETENTION_DAYS:"90",CLAUDE_MEM_SUMMARY_RETENTION_DAYS:"365",CLAUDE_MEM_AUTO_CLEANUP_ENABLED:"false",CLAUDE_MEM_AUDIT_REVIEW_INTERVAL_DAYS:"30"};static getAllDefaults(){return{...this.DEFAULTS}}static get(e){return process.env[e]??this.DEFAULTS[e]}static getInt(e){let t=this.get(e);return parseInt(t,10)}static getBool(e){let t=this.get(e);return t==="true"||t===!0}static applyEnvOverrides(e){let t={...e};for(let s of Object.keys(this.DEFAULTS))process.env[s]!==void 0&&(t[s]=process.env[s]);return t}static loadFromFile(e){try{if(!(0,y.existsSync)(e)){let i=this.getAllDefaults();try{let a=(0,se.dirname)(e);(0,y.existsSync)(a)||(0,y.mkdirSync)(a,{recursive:!0}),(0,y.writeFileSync)(e,JSON.stringify(i,null,2),"utf-8"),console.log("[SETTINGS] Created settings file with defaults:",e)}catch(a){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,a)}return this.applyEnvOverrides(i)}let t=(0,y.readFileSync)(e,"utf-8"),s=JSON.parse(t),n=s;if(s.env&&typeof s.env=="object"){n=s.env;try{(0,y.writeFileSync)(e,JSON.stringify(n,null,2),"utf-8"),console.log("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(i){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,i)}}let o={...this.DEFAULTS};for(let i of Object.keys(this.DEFAULTS))n[i]!==void 0&&(o[i]=n[i]);return this.applyEnvOverrides(o)}catch(t){return console.warn("[SETTINGS] Failed to load settings, using defaults:",e,t),this.applyEnvOverrides(this.getAllDefaults())}}};var G=require("fs"),ne=require("path");var A=class r{static instance=null;activeMode=null;modesDir;constructor(){let e=Fe(),t=[(0,ne.join)(e,"modes"),(0,ne.join)(e,"..","plugin","modes")],s=t.find(n=>(0,G.existsSync)(n));this.modesDir=s||t[0]}static getInstance(){return r.instance||(r.instance=new r),r.instance}parseInheritance(e){let t=e.split("--");if(t.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(t.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:t[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,t){let s={...e};for(let n in t){let o=t[n],i=e[n];this.isPlainObject(o)&&this.isPlainObject(i)?s[n]=this.deepMerge(i,o):s[n]=o}return s}loadModeFile(e){let t=(0,ne.join)(this.modesDir,`${e}.json`);if(!(0,G.existsSync)(t))throw new Error(`Mode file not found: ${t}`);let s=(0,G.readFileSync)(t,"utf-8");return JSON.parse(s)}loadMode(e){let t=this.parseInheritance(e);if(!t.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,c.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(p=>p.id),concepts:d.observation_concepts.map(p=>p.id)}),d}catch{if(c.warn("SYSTEM",`Mode file not found: ${e}, falling back to 'code'`),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:s,overrideId:n}=t,o;try{o=this.loadMode(s)}catch{c.warn("SYSTEM",`Parent mode '${s}' not found for ${e}, falling back to 'code'`),o=this.loadMode("code")}let i;try{i=this.loadModeFile(n),c.debug("SYSTEM",`Loaded override file: ${n} for parent ${s}`)}catch{return c.warn("SYSTEM",`Override file '${n}' not found, using parent mode '${s}' only`),this.activeMode=o,o}if(!i)return c.warn("SYSTEM",`Invalid override file: ${n}, using parent mode '${s}' only`),this.activeMode=o,o;let a=this.deepMerge(o,i);return this.activeMode=a,c.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${s} + ${n})`,void 0,{parent:s,override:n,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getObservationConcepts(){return this.getActiveMode().observation_concepts}getTypeIcon(e){return this.getObservationTypes().find(s=>s.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(s=>s.id===e)?.work_emoji||"\u{1F4DD}"}validateType(e){return this.getObservationTypes().some(t=>t.id===e)}getTypeLabel(e){return this.getObservationTypes().find(s=>s.id===e)?.label||e}};function le(){let r=xe,e=te.loadFromFile(r),t=A.getInstance().getActiveMode(),s=new Set(t.observation_types.map(o=>o.id)),n=new Set(t.observation_concepts.map(o=>o.id));return{totalObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.CLAUDE_MEM_CONTEXT_SESSION_COUNT,10),showReadTokens:e.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:s,observationConcepts:n,fullObservationField:e.CLAUDE_MEM_CONTEXT_FULL_FIELD,showLastSummary:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE==="true"}}var _={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},He=4,ue=1;function me(r){let e=(r.title?.length||0)+(r.subtitle?.length||0)+(r.narrative?.length||0)+JSON.stringify(r.facts||[]).length;return Math.ceil(e/He)}function Te(r){let e=r.length,t=r.reduce((i,a)=>i+me(a),0),s=r.reduce((i,a)=>i+(a.discovery_tokens||0),0),n=s-t,o=s>0?Math.round(n/s*100):0;return{totalObservations:e,totalReadTokens:t,totalDiscoveryTokens:s,savings:n,savingsPercent:o}}function es(r){return A.getInstance().getWorkEmoji(r)}function j(r,e){let t=me(r),s=r.discovery_tokens||0,n=es(r.type),o=s>0?`${n} ${s.toLocaleString()}`:"-";return{readTokens:t,discoveryTokens:s,discoveryDisplay:o,workEmoji:n}}function re(r){return r.showReadTokens||r.showWorkTokens||r.showSavingsAmount||r.showSavingsPercent}var We=q(require("path"),1),oe=require("fs");var Ye=2;function ge(r,e,t){let s=Array.from(t.observationTypes),n=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(","),a=t.totalObservationCount*Ye,d=r.db.prepare(`
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
  `).all(e,...s,...o,a);return he(d,t.totalObservationCount)}function fe(r,e,t){return r.db.prepare(`
    SELECT id, memory_session_id, request, investigated, learned, completed, next_steps, created_at, created_at_epoch
    FROM session_summaries
    WHERE project = ?
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(e,t.sessionCount+ue)}function Ve(r,e,t){let s=Array.from(t.observationTypes),n=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(","),a=e.map(()=>"?").join(","),d=t.totalObservationCount*Ye,p=r.db.prepare(`
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
  `).all(...e,...s,...o,d);return he(p,t.totalObservationCount)}function qe(r,e,t){let s=e.map(()=>"?").join(",");return r.db.prepare(`
    SELECT id, memory_session_id, request, investigated, learned, completed, next_steps, created_at, created_at_epoch, project
    FROM session_summaries
    WHERE project IN (${s})
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(...e,t.sessionCount+ue)}function ts(r,e){let t=(e-r.created_at_epoch)/3600,s=Math.max(0,1-t/168),n=0;if(r.title&&r.title.trim().length>0&&(n+=.1),r.facts)try{let o=JSON.parse(r.facts);Array.isArray(o)&&(n+=Math.min(o.length*.1,.3))}catch{r.facts.trim().length>0&&(n+=.1)}if(r.concepts)try{let o=JSON.parse(r.concepts);Array.isArray(o)&&(n+=Math.min(o.length*.05,.2))}catch{r.concepts.trim().length>0&&(n+=.05)}if(r.narrative&&r.narrative.trim().length>0&&(n+=.1),r.files_modified)try{let o=JSON.parse(r.files_modified);Array.isArray(o)&&o.length>0&&(n+=.1)}catch{r.files_modified.trim().length>0&&(n+=.1)}return s+n}function he(r,e){if(r.length<=e)return r;let t=Math.floor(Date.now()/1e3),s=r.map(o=>({obs:o,score:ts(o,t)}));s.sort((o,i)=>i.score-o.score);let n=s.slice(0,e).map(o=>o.obs);return n.sort((o,i)=>i.created_at_epoch-o.created_at_epoch),n}function ss(r){return r.replace(/\//g,"-")}function ns(r){try{if(!(0,oe.existsSync)(r))return{userMessage:"",assistantMessage:""};let e=(0,oe.readFileSync)(r,"utf-8").trim();if(!e)return{userMessage:"",assistantMessage:""};let t=e.split(`
`).filter(n=>n.trim()),s="";for(let n=t.length-1;n>=0;n--)try{let o=t[n];if(!o.includes('"type":"assistant"'))continue;let i=JSON.parse(o);if(i.type==="assistant"&&i.message?.content&&Array.isArray(i.message.content)){let a="";for(let d of i.message.content)d.type==="text"&&(a+=d.text);if(a=a.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g,"").trim(),a){s=a;break}}}catch(o){c.debug("PARSER","Skipping malformed transcript line",{lineIndex:n},o);continue}return{userMessage:"",assistantMessage:s}}catch(e){return c.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r},e),{userMessage:"",assistantMessage:""}}}function Ne(r,e,t,s){if(!e.showLastMessage||r.length===0)return{userMessage:"",assistantMessage:""};let n=r.find(d=>d.memory_session_id!==t);if(!n)return{userMessage:"",assistantMessage:""};let o=n.memory_session_id,i=ss(s),a=We.default.join(k,"projects",i,`${o}.jsonl`);return ns(a)}function Ke(r,e){let t=e[0]?.id;return r.map((s,n)=>{let o=n===0?null:e[n+1];return{...s,displayEpoch:o?o.created_at_epoch:s.created_at_epoch,displayTime:o?o.created_at:s.created_at,shouldShowLink:s.id!==t}})}function be(r,e){let t=[...r.map(s=>({type:"observation",data:s})),...e.map(s=>({type:"summary",data:s}))];return t.sort((s,n)=>{let o=s.type==="observation"?s.data.created_at_epoch:s.data.displayEpoch,i=n.type==="observation"?n.data.created_at_epoch:n.data.displayEpoch;return o-i}),t}function Je(r,e){return new Set(r.slice(0,e).map(t=>t.id))}function Qe(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function ze(r){return[`# $CMEM ${r} ${Qe()}`,""]}function Ze(){return[`Legend: \u{1F3AF}session ${A.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji}${t.id}`).join(" ")}`,"Format: ID TIME TYPE TITLE","Fetch details: get_observations([IDs]) | Search: mem-search skill",""]}function et(){return[]}function tt(){return[]}function st(r,e){let t=[],s=[`${r.totalObservations} obs (${r.totalReadTokens.toLocaleString()}t read)`,`${r.totalDiscoveryTokens.toLocaleString()}t work`];return r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)&&(e.showSavingsPercent?s.push(`${r.savingsPercent}% savings`):e.showSavingsAmount&&s.push(`${r.savings.toLocaleString()}t saved`)),t.push(`Stats: ${s.join(" | ")}`),t.push(""),t}function nt(r){return[`### ${r}`]}function rt(r){return r.toLowerCase().replace(" am","a").replace(" pm","p")}function ot(r,e,t){let s=r.title||"Untitled",n=A.getInstance().getTypeIcon(r.type),o=e?rt(e):'"';return`${r.id} ${o} ${n} ${s}`}function it(r,e,t,s){let n=[],o=r.title||"Untitled",i=A.getInstance().getTypeIcon(r.type),a=e?rt(e):'"',{readTokens:d,discoveryDisplay:p}=j(r,s);n.push(`**${r.id}** ${a} ${i} **${o}**`),t&&n.push(t);let E=[];return s.showReadTokens&&E.push(`~${d}t`),s.showWorkTokens&&E.push(p),E.length>0&&n.push(E.join(" ")),n.push(""),n}function at(r,e){return[`S${r.id} ${r.request||"Session started"} (${e})`]}function B(r,e){return e?[`**${r}**: ${e}`,""]:[]}function dt(r){return r.assistantMessage?["","---","","**Previously**","",`A: ${r.assistantMessage}`,""]:[]}function ct(r,e){return["",`Access ${Math.round(r/1e3)}k tokens of past work via get_observations([IDs]) or mem-search skill.`]}function Et(r){return`# $CMEM ${r} ${Qe()}

No previous sessions found.`}function pt(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function _t(r){return["",`${_.bright}${_.cyan}[${r}] recent context, ${pt()}${_.reset}`,`${_.gray}${"\u2500".repeat(60)}${_.reset}`,""]}function lt(){let e=A.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ");return[`${_.dim}Legend: session-request | ${e}${_.reset}`,""]}function ut(){return[`${_.bright}Column Key${_.reset}`,`${_.dim}  Read: Tokens to read this observation (cost to learn it now)${_.reset}`,`${_.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${_.reset}`,""]}function mt(){return[`${_.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${_.reset}`,"",`${_.dim}When you need implementation details, rationale, or debugging context:${_.reset}`,`${_.dim}  - Fetch by ID: get_observations([IDs]) for observations visible in this index${_.reset}`,`${_.dim}  - Search history: Use the mem-search skill for past decisions, bugs, and deeper research${_.reset}`,`${_.dim}  - Trust this index over re-reading code for past decisions and learnings${_.reset}`,""]}function Tt(r,e){let t=[];if(t.push(`${_.bright}${_.cyan}Context Economics${_.reset}`),t.push(`${_.dim}  Loading: ${r.totalObservations} observations (${r.totalReadTokens.toLocaleString()} tokens to read)${_.reset}`),t.push(`${_.dim}  Work investment: ${r.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${_.reset}`),r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let s="  Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?s+=`${r.savings.toLocaleString()} tokens (${r.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?s+=`${r.savings.toLocaleString()} tokens`:s+=`${r.savingsPercent}% reduction from reuse`,t.push(`${_.green}${s}${_.reset}`)}return t.push(""),t}function gt(r){return[`${_.bright}${_.cyan}${r}${_.reset}`,""]}function ft(r){return[`${_.dim}${r}${_.reset}`]}function ht(r,e,t,s){let n=r.title||"Untitled",o=A.getInstance().getTypeIcon(r.type),{readTokens:i,discoveryTokens:a,workEmoji:d}=j(r,s),p=t?`${_.dim}${e}${_.reset}`:" ".repeat(e.length),E=s.showReadTokens&&i>0?`${_.dim}(~${i}t)${_.reset}`:"",m=s.showWorkTokens&&a>0?`${_.dim}(${d} ${a.toLocaleString()}t)${_.reset}`:"";return`  ${_.dim}#${r.id}${_.reset}  ${p}  ${o}  ${n} ${E} ${m}`}function Nt(r,e,t,s,n){let o=[],i=r.title||"Untitled",a=A.getInstance().getTypeIcon(r.type),{readTokens:d,discoveryTokens:p,workEmoji:E}=j(r,n),m=t?`${_.dim}${e}${_.reset}`:" ".repeat(e.length),l=n.showReadTokens&&d>0?`${_.dim}(~${d}t)${_.reset}`:"",u=n.showWorkTokens&&p>0?`${_.dim}(${E} ${p.toLocaleString()}t)${_.reset}`:"";return o.push(`  ${_.dim}#${r.id}${_.reset}  ${m}  ${a}  ${_.bright}${i}${_.reset}`),s&&o.push(`    ${_.dim}${s}${_.reset}`),(l||u)&&o.push(`    ${l} ${u}`),o.push(""),o}function bt(r,e){let t=`${r.request||"Session started"} (${e})`;return[`${_.yellow}#S${r.id}${_.reset} ${t}`,""]}function H(r,e,t){return e?[`${t}${r}:${_.reset} ${e}`,""]:[]}function St(r){return r.assistantMessage?["","---","",`${_.bright}${_.magenta}Previously${_.reset}`,"",`${_.dim}A: ${r.assistantMessage}${_.reset}`,""]:[]}function Rt(r,e){let t=Math.round(r/1e3);return["",`${_.dim}Access ${t}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use the mem-search skill to access memories by ID.${_.reset}`]}function Ot(r){return`
${_.bright}${_.cyan}[${r}] recent context, ${pt()}${_.reset}
${_.gray}${"\u2500".repeat(60)}${_.reset}

${_.dim}No previous sessions found for this project yet.${_.reset}
`}function It(r,e,t,s){let n=[];return s?n.push(..._t(r)):n.push(...ze(r)),s?n.push(...lt()):n.push(...Ze()),s?n.push(...ut()):n.push(...et()),s?n.push(...mt()):n.push(...tt()),re(t)&&(s?n.push(...Tt(e,t)):n.push(...st(e,t))),n}var Se=q(require("path"),1);function x(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[]}catch(e){return c.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:r?.substring(0,50)},e),[]}}function Re(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function Oe(r){return new Date(r).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function Lt(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function At(r,e){return Se.default.isAbsolute(r)?Se.default.relative(e,r):r}function vt(r,e,t){let s=x(r);if(s.length>0)return At(s[0],e);if(t){let n=x(t);if(n.length>0)return At(n[0],e)}return"General"}function rs(r){let e=new Map;for(let s of r){let n=s.type==="observation"?s.data.created_at:s.data.displayTime,o=Lt(n);e.has(o)||e.set(o,[]),e.get(o).push(s)}let t=Array.from(e.entries()).sort((s,n)=>{let o=new Date(s[0]).getTime(),i=new Date(n[0]).getTime();return o-i});return new Map(t)}function Ct(r,e){return e.fullObservationField==="narrative"?r.narrative:r.facts?x(r.facts).join(`
`):null}function os(r,e,t,s,n=!1){let o=[];o.push(...nt(r));let i="";for(let a of e)if(a.type==="summary"){i="";let d=a.data,p=Re(d.displayTime);o.push(...at(d,p))}else{let d=a.data,p=Oe(d.created_at),m=p!==i?p:"";if(i=p,n){let u=d.facts&&x(d.facts)[0]||"";o.push(`- [${d.type}] ${d.title}${u?": "+u:""}`);continue}if(t.has(d.id)){let u=Ct(d,s);o.push(...it(d,m,u,s))}else o.push(ot(d,m,s))}return o}function is(r,e,t,s,n,o=!1){let i=[];i.push(...gt(r));let a=null,d="";for(let p of e)if(p.type==="summary"){a=null,d="";let E=p.data,m=Re(E.displayTime);i.push(...bt(E,m))}else{let E=p.data,m=vt(E.files_modified,n,E.files_read),l=Oe(E.created_at),u=l!==d;if(d=l,o){let R=E.facts&&x(E.facts)[0]||"";i.push(`- [${E.type}] ${E.title}${R?": "+R:""}`);continue}let g=t.has(E.id);if(m!==a&&(i.push(...ft(m)),a=m),g){let R=Ct(E,s);i.push(...Nt(E,l,u,R,s))}else i.push(ht(E,l,u,s))}return i.push(""),i}function as(r,e,t,s,n,o,i=!1){return o?is(r,e,t,s,n,i):os(r,e,t,s,i)}function yt(r,e,t,s,n,o=!1){let i=[],a=rs(r);for(let[d,p]of a)i.push(...as(d,p,e,t,s,n,o));return i}function Dt(r,e,t){return!(!r.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||t&&e.created_at_epoch<=t.created_at_epoch)}function Mt(r,e){let t=[];return e?(t.push(...H("Investigated",r.investigated,_.blue)),t.push(...H("Learned",r.learned,_.yellow)),t.push(...H("Completed",r.completed,_.green)),t.push(...H("Next Steps",r.next_steps,_.magenta))):(t.push(...B("Investigated",r.investigated)),t.push(...B("Learned",r.learned)),t.push(...B("Completed",r.completed)),t.push(...B("Next Steps",r.next_steps))),t}function Ut(r,e){return e?St(r):dt(r)}function kt(r,e,t){return!re(e)||r.totalDiscoveryTokens<=0||r.savings<=0?[]:t?Rt(r.totalDiscoveryTokens,r.totalReadTokens):ct(r.totalDiscoveryTokens,r.totalReadTokens)}function Ie(r,e){if(!r)return[];let t=r.agent_soul,s=r.user;if(!t?.name&&!t?.vibe&&!s?.name)return[];let n=[];return n.push("<agent-identity>"),t?.name&&n.push(`You are ${t.name}.`),t?.self_description&&n.push(t.self_description),t?.vibe&&n.push(`Style: ${t.vibe}`),t?.running_environment&&n.push(`Running on: ${t.running_environment}`),s?.name&&(n.push(""),n.push(`User: ${s.name}`),s.role&&n.push(`Role: ${s.role}`),s.language&&n.push(`Language: ${s.language}`)),r.style?.tone&&(n.push(""),n.push(`Communication: ${r.style.tone}`)),n.push("</agent-identity>"),n.push(""),n}function ds(r){if(!r||r.length===0)return[];let e=[],t=r.filter(i=>i.status==="completed").length,s=r.length,n=r.find(i=>i.status==="in_progress"),o=n?n.name:"All complete";e.push(`Progress: Step ${n?t+1:t}/${s} \u2014 ${o}`);for(let i of r)i.status==="completed"?e.push(`[x] ${i.name}`):i.status==="in_progress"?e.push(`[>] ${i.name}  \u2190 current`):e.push(`[ ] ${i.name}`);return e}function Ae(r,e){if(!r)return[];let t=[];t.push("<active-task>"),r.status==="blocked"?(t.push(`**Blocked Task**: ${r.task_name}`),r.progress&&t.push(`Progress: ${r.progress}`),r.next_step&&t.push(`Blocker: ${r.next_step}`)):t.push(`**Active Task**: ${r.task_name}`);let s=!1;if(r.context_json)try{let n=JSON.parse(r.context_json);Array.isArray(n.checkpoints)&&n.checkpoints.length>0&&(s=!0,t.push(...ds(n.checkpoints)))}catch{}if(!s&&r.status!=="blocked"&&(r.progress&&t.push(`Progress: ${r.progress}`),r.next_step&&t.push(`Next: ${r.next_step}`)),r.interrupted_tasks_json)try{let n=JSON.parse(r.interrupted_tasks_json);if(Array.isArray(n)&&n.length>0){t.push(""),t.push("Interrupted tasks:");for(let o of n)t.push(`- ${o.task_name||o.name} (paused at: ${o.progress||"unknown"})`)}}catch{}return t.push("</active-task>"),t.push(""),t}function xt(r){let e="## Memory Protocol";return[r?`\x1B[1;36m${e}\x1B[0m`:e,"1. Before answering about past facts, search memory to verify \u2014 do not guess","2. When you discover information contradicting stored memory, flag it and request an update","3. User preferences, decisions, and corrections are worth recording",""]}var cs={L0:.08,L1:.15,L2:.6,L3:.17},de=["L0","L1","L2","L3"],Es=3e3,ps=1500,_s=8e3,L=class{totalBudget;allocations;consumed;constructor(e=Es){this.totalBudget=Math.min(Math.max(e,ps),_s);let t={},s=0;for(let o=0;o<de.length-1;o++){let i=de[o];t[i]=Math.floor(this.totalBudget*cs[i]),s+=t[i]}let n=de[de.length-1];t[n]=this.totalBudget-s,this.allocations=t,this.consumed={L0:0,L1:0,L2:0,L3:0}}getBudget(e){return this.allocations[e]}remaining(e){return this.allocations[e]-this.consumed[e]}canFit(e,t){return t<=this.remaining(e)}consume(e,t){this.consumed[e]+=t}static estimateTokens(e){return!e||e.length===0?0:Math.ceil(e.length/4)}};var wt={agent_soul:[{field:"name",required:!0},{field:"self_description",required:!1},{field:"core_values",required:!1},{field:"vibe",required:!1}],user:[{field:"name",required:!0},{field:"role",required:!0},{field:"language",required:!1},{field:"timezone",required:!1},{field:"profession",required:!1}],style:[{field:"tone",required:!0},{field:"brevity",required:!1},{field:"formatting",required:!1},{field:"output_structure",required:!1}],workflow:[{field:"preferred_role",required:!0},{field:"decision_style",required:!1},{field:"recurring_tasks",required:!1}]},ls=Object.keys(wt),us=90;function ms(r){return r==null?!0:Object.keys(r).length===0}function Ts(r,e){if(!r)return!1;let t=r[e];return!(t==null||t===""||Array.isArray(t)&&t.length===0)}var W=class{check(e){let t=0,s=0,n=[],o=[];for(let a of ls){let d=e[a],p=wt[a];if(s+=p.length,ms(d)){n.push(a);for(let E of p)E.required&&o.push(`${a}.${E.field}`);continue}for(let E of p)Ts(d,E.field)?t++:E.required&&o.push(`${a}.${E.field}`)}return{percentage:s===0?0:Math.round(t/s*100),gaps:n,missingFields:o}}checkStaleness(e,t=new Date){let s=[],n=us*24*60*60*1e3;for(let[o,i]of Object.entries(e)){if(!i)continue;let a=new Date(i);if(isNaN(a.getTime()))continue;t.getTime()-a.getTime()>n&&s.push(o)}return{staleFields:s}}};var Y=class{constructor(e){this.db=e}getProfile(e,t){let s=this.db.prepare("SELECT content_json FROM agent_profiles WHERE scope = ? AND profile_type = ?").get(e,t);if(!s)return null;try{return JSON.parse(s.content_json)}catch{return null}}setProfile(e,t,s){let n=new Date().toISOString(),o=Date.now(),i=JSON.stringify(s);this.db.prepare(`
      INSERT INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch, updated_at, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, profile_type) DO UPDATE SET
        content_json = excluded.content_json,
        updated_at = excluded.updated_at,
        updated_at_epoch = excluded.updated_at_epoch
    `).run(e,t,i,n,o,n,o),c.debug("PERSONA",`Set ${t} profile for scope: ${e}`)}getMergedPersona(e){let t=["agent_soul","user","style","workflow"],s={};for(let n of t){let o=this.getProfile("global",n)||{},i=e?this.getProfile(e,n)||{}:{};s[n]={...o};for(let[a,d]of Object.entries(i))d!=null&&d!==""&&(s[n][a]=d)}return s}detectConflicts(e){if(!e)return[];let t=["user","style","workflow"],s=[];for(let n of t){let o=this.getProfile("global",n),i=this.getProfile(e,n);if(!(!o||!i))for(let a of Object.keys(i)){let d=o[a],p=i[a];d==null||d===""||p==null||p===""||JSON.stringify(d)!==JSON.stringify(p)&&s.push({profile_type:n,field:a,global_value:d,project_value:p})}}return s}resolveConflict(e,t,s,n,o){let i=this.getProfile("global",t)||{},a=this.getProfile(e,t)||{};switch(n){case"keep_global":{delete a[s],this.setProfile(e,t,a);break}case"keep_project":{i[s]=a[s],this.setProfile("global",t,i);break}case"custom":{i[s]=o,a[s]=o,this.setProfile("global",t,i),this.setProfile(e,t,a);break}}c.debug("PERSONA",`Resolved conflict: ${t}.${s} via ${n} for project ${e}`)}getBootstrapStatus(e){return this.db.prepare("SELECT * FROM bootstrap_state WHERE scope = ?").get(e)||null}updateBootstrapStatus(e,t,s,n){let o=new Date().toISOString();if(this.getBootstrapStatus(e)){let a=["status = ?"],d=[t];s!==void 0&&(a.push("round = ?"),d.push(s)),n&&(a.push("metadata_json = ?"),d.push(JSON.stringify(n))),t==="completed"&&(a.push("completed_at = ?"),d.push(o)),d.push(e),this.db.prepare(`UPDATE bootstrap_state SET ${a.join(", ")} WHERE scope = ?`).run(...d)}else this.db.prepare(`
        INSERT INTO bootstrap_state (scope, status, round, started_at, metadata_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(e,t,s||0,o,n?JSON.stringify(n):null);c.debug("PERSONA",`Bootstrap status for ${e}: ${t}`)}getActiveTask(e){return this.db.prepare("SELECT * FROM active_tasks WHERE project = ? AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 1").get(e)||null}setActiveTask(e,t){let s=new Date().toISOString(),n=Date.now();this.db.prepare("UPDATE active_tasks SET status = 'completed', updated_at = ?, updated_at_epoch = ? WHERE project = ? AND status IN ('in_progress', 'blocked')").run(s,n,e),this.db.prepare(`
      INSERT INTO active_tasks (project, task_name, status, progress, next_step, context_json, interrupted_tasks_json, started_at, started_at_epoch, updated_at, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t.task_name,t.status||"in_progress",t.progress||null,t.next_step||null,t.context_json?JSON.stringify(t.context_json):null,t.interrupted_tasks_json?JSON.stringify(t.interrupted_tasks_json):null,s,n,s,n),c.debug("PERSONA",`Set active task for ${e}: ${t.task_name}`)}updateActiveTask(e,t){let s=new Date().toISOString(),n=Date.now(),o=["updated_at = ?","updated_at_epoch = ?"],i=[s,n];t.status&&(o.push("status = ?"),i.push(t.status)),t.progress&&(o.push("progress = ?"),i.push(t.progress)),t.next_step&&(o.push("next_step = ?"),i.push(t.next_step)),t.context_json&&(o.push("context_json = ?"),i.push(JSON.stringify(t.context_json))),t.interrupted_tasks_json&&(o.push("interrupted_tasks_json = ?"),i.push(JSON.stringify(t.interrupted_tasks_json))),i.push(e),this.db.prepare(`UPDATE active_tasks SET ${o.join(", ")} WHERE project = ? AND status IN ('in_progress', 'blocked')`).run(...i)}completeActiveTask(e){let t=new Date().toISOString(),s=Date.now();this.db.prepare("UPDATE active_tasks SET status = 'completed', updated_at = ?, updated_at_epoch = ? WHERE project = ? AND status IN ('in_progress', 'blocked')").run(t,s,e),c.debug("PERSONA",`Completed active task for ${e}`)}getTaskCheckpoints(e){let t=this.getActiveTask(e);if(!t||!t.context_json)return[];try{let s=JSON.parse(t.context_json);return Array.isArray(s.checkpoints)?s.checkpoints:[]}catch{return[]}}setCheckpoints(e,t){let s=this.getActiveTask(e);if(!s)return;let n={};if(s.context_json)try{n=JSON.parse(s.context_json)}catch{n={}}this.updateActiveTask(e,{context_json:{...n,checkpoints:t}}),c.debug("PERSONA",`Set ${t.length} checkpoints for ${e}`)}addCheckpoint(e,t){let s=this.getTaskCheckpoints(e),n={name:t,status:s.length===0?"in_progress":"pending"};s.push(n),this.setCheckpoints(e,s),c.debug("PERSONA",`Added checkpoint "${t}" for ${e}`)}completeCheckpoint(e,t){let s=this.getTaskCheckpoints(e),n=s.findIndex(l=>l.name===t);if(n===-1)return;s[n].status="completed",s[n].completed_at=new Date().toISOString();let o=s.find(l=>l.status==="pending");o&&(o.status="in_progress");let i=s.filter(l=>l.status==="completed").length,a=s.length,d=o?.name,p=d?`Step ${i+1}/${a}: ${d}`:`Step ${i}/${a}: All complete`,E=this.getActiveTask(e);if(!E)return;let m={};if(E.context_json)try{m=JSON.parse(E.context_json)}catch{m={}}this.updateActiveTask(e,{progress:p,context_json:{...m,checkpoints:s}}),c.debug("PERSONA",`Completed checkpoint "${t}" for ${e}`)}checkCompleteness(e){let t=this.getMergedPersona(e);return new W().check(t)}checkStaleness(e){let t=new W,s=this.db.prepare("SELECT profile_type, updated_at FROM agent_profiles WHERE scope = ? OR scope = 'global'").all(e),n={};for(let o of s)n[o.profile_type]=o.updated_at;return t.checkStaleness(n)}getProjectSchema(e){let t=this.db.prepare("SELECT content_json FROM agent_profiles WHERE scope = ? AND profile_type = 'project_schema'").get(e);if(!t)return null;try{return JSON.parse(t.content_json)}catch{return null}}setProjectSchema(e,t){let s=new Date().toISOString();this.db.prepare("INSERT OR REPLACE INTO agent_profiles (scope, profile_type, content_json, updated_at) VALUES (?, 'project_schema', ?, ?)").run(e,JSON.stringify(t),s),c.debug("PERSONA",`Set project_schema for scope: ${e}`)}};var w=require("fs"),Ee=require("path"),Xt=require("crypto");function gs(r){return(0,Xt.createHash)("sha256").update(r,"utf-8").digest("hex")}function fs(r){let e=r.split(`
`);if(e[0]?.trim()!=="---")return null;let t=-1;for(let i=1;i<e.length;i++)if(e[i].trim()==="---"){t=i;break}if(t===-1)return null;let s=e.slice(1,t),n={};for(let i of s){let a=i.indexOf(":");if(a===-1)continue;let d=i.slice(0,a).trim(),p=i.slice(a+1).trim();d==="name"?n.name=p:d==="description"?n.description=p:d==="type"&&(n.type=p)}let o=e.slice(t+1).join(`
`).trim();return{frontmatter:n,body:o}}var ce=class{constructor(e,t){this.db=e;this.memoryDir=t}syncIncremental(){return this.runSync(!1)}fullImport(){return this.db.prepare("DELETE FROM sync_state").run(),this.runSync(!0)}runSync(e){let t={imported:0,skipped:0,errors:[]};if(!(0,w.existsSync)(this.memoryDir))return t;let s;try{s=(0,w.readdirSync)(this.memoryDir).filter(n=>(0,Ee.extname)(n)===".md")}catch(n){return t.errors.push(`Failed to read memoryDir: ${String(n)}`),t}for(let n of s){let o=(0,Ee.join)(this.memoryDir,n),i;try{i=(0,w.readFileSync)(o,"utf-8")}catch(l){t.errors.push(`Failed to read ${n}: ${String(l)}`);continue}let a=gs(i);if(!e){let l=this.db.prepare("SELECT content_hash FROM sync_state WHERE file_path = ?").get(o);if(l&&l.content_hash===a){t.skipped++;continue}}let d=fs(i);if(!d){t.skipped++;continue}let{frontmatter:p,body:E}=d,m=p.type;if(m==="user")try{this.upsertUserProfile(E),this.upsertSyncState(o,a,"user"),t.imported++}catch(l){t.errors.push(`Failed to sync user file ${n}: ${String(l)}`)}else if(m==="feedback")try{this.insertFeedbackObservation(p.name,E),this.upsertSyncState(o,a,"feedback"),t.imported++}catch(l){t.errors.push(`Failed to sync feedback file ${n}: ${String(l)}`)}else t.skipped++}return t}upsertUserProfile(e){let t=new Date().toISOString(),s=Date.now(),n=JSON.stringify({raw:e});this.db.prepare(`
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
    `).run(e,t,s,n)}};var $t=require("fs"),hs=Le.default.join((0,ve.homedir)(),".claude","plugins","marketplaces","agent-recall","plugin",".install-version");function Ns(){try{return new Z}catch(r){if(r.code==="ERR_DLOPEN_FAILED"){try{(0,Pt.unlinkSync)(hs)}catch(e){c.debug("SYSTEM","Marker file cleanup failed (may not exist)",{},e)}return c.error("SYSTEM","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw r}}function Ft(r,e,t){let s=e?Ot(r):Et(r);return!t||t.status!=="completed"?s+(e?`
\x1B[33m\x1B[1m\u2605 Welcome to Agent Recall!\x1B[0m
\x1B[33mRun /bootstrap to set up your agent persona and preferences.\x1B[0m
\x1B[2mThis creates a persistent identity that carries across sessions.\x1B[0m
`:`
**Welcome to Agent Recall!** Run /bootstrap to set up your agent persona and preferences.
This creates a persistent identity that carries across sessions.
`):s}function bs(r,e,t,s,n,o,i,a,d,p,E,m,l){let u=[];if(a){let h=Ie(a,i);if(u.push(...h),E){let O=h.join(`
`);E.consume("L0",L.estimateTokens(O))}}let g=xt(i);if(u.push(...g),E){let h=g.join(`
`);E.consume("L0",L.estimateTokens(h))}if(p&&p.length>0){let h=`\u26A0 Persona conflicts detected (${p.length} field${p.length>1?"s":""} differ between global and project). Use /api/persona/conflicts?project=${encodeURIComponent(r)} to review.`;u.push(h,"")}if(d){let h=Ae(d,i),O=h.join(`
`),I=L.estimateTokens(O);(!E||E.canFit("L1",I))&&(u.push(...h),E&&E.consume("L1",I))}if(m&&m.length>0&&u.push(...m),!d&&t.length>0&&t[0].next_steps){let h=t[0].next_steps.trim();if(h){let O;i?O=[`\x1B[33m\u25C6 Last session's next steps:\x1B[0m ${h}`,""]:O=[`**Last session's next steps:** ${h}`,""];let I=O.join(`
`),U=L.estimateTokens(I);(!E||E.canFit("L1",U))&&(u.push(...O),E&&E.consume("L1",U))}}let R=Te(e);if(u.push(...It(r,R,s,i)),l&&l.length>0){let O=l.map(U=>`### ${U.topic}
${U.content}`).join(`

`),I=L.estimateTokens(O);E&&E.canFit("L2",I)&&(u.push(`
## Project Knowledge
`),u.push(O),E.consume("L2",I))}let T=e;if(E){let h=E.remaining("L2"),O=0;T=e.filter(I=>{let U=[I.title,I.narrative,I.facts?JSON.stringify(I.facts):null].filter(Boolean).join(" "),ye=L.estimateTokens(U);return O+ye<=h?(O+=ye,!0):!1})}let f=t.slice(0,s.sessionCount),b=Ke(f,t),N=be(T,b),C=Je(T,s.fullObservationCount);u.push(...yt(N,C,s,n,i,!0));let X=t[0],M=T[0];Dt(s,X,M)&&u.push(...Mt(X,i));let F=Ne(T,s,o,n);return u.push(...Ut(F,i)),u.push(...kt(R,s,i)),u.join(`
`).trimEnd()}async function Ce(r,e=!1){let t=le(),s=r?.cwd??process.cwd(),n=je(s),o=r?.globalMode??Ge(s),i=r?.projects||[n];r?.full&&(t.totalObservationCount=999999,t.sessionCount=999999);let a=Ns();if(!a)return"";try{let d=Le.default.join((0,ve.homedir)(),".claude","memory");if((0,$t.existsSync)(d)){let E=new ce(a.db,d).syncIncremental();E.imported>0&&c.debug("CONTEXT",`Auto memory sync: imported ${E.imported} entries`)}}catch(d){c.debug("CONTEXT","Auto memory sync failed (non-blocking)",{error:String(d)})}try{if(o){c.debug("CONTEXT","Global Quick Mode \u2014 skipping project-specific context",{cwd:s,project:n});let N=null,C=null,X=null;try{let h=new Y(a.db);N=h.getMergedPersona("__global__"),X=h.getBootstrapStatus("__global__"),C=h.getActiveTask(n)}catch(h){c.debug("CONTEXT","Persona query skipped in global mode (tables may not exist yet)",{},h)}let M=[],F=new L(t.tokenBudget||3e3);if(e?M.push("\x1B[36m\x1B[1m\u25CF Global Mode\x1B[0m \x1B[2m\u2014 launched from home directory\x1B[0m",""):M.push("**Global Mode** \u2014 launched from home directory",""),N){let h=Ie(N,e);M.push(...h);let O=h.join(`
`);F.consume("L0",L.estimateTokens(O))}if(C){let h=Ae(C,e),O=h.join(`
`),I=L.estimateTokens(O);F.canFit("L1",I)&&(M.push(...h),F.consume("L1",I))}if(!N?.agent_soul?.name){let h=Ft(n,e,X);h&&M.push(h)}return M.join(`
`).trimEnd()}let d=i.length>1?Ve(a,i,t):ge(a,n,t),p=i.length>1?qe(a,i,t):fe(a,n,t),E=null,m=null,l=null,u=[],g=null;try{g=new Y(a.db),E=g.getMergedPersona(n),m=g.getActiveTask(n),l=g.getBootstrapStatus("__global__"),u=g.detectConflicts(n)}catch(N){c.debug("CONTEXT","Persona query skipped (tables may not exist yet)",{},N)}if(d.length===0&&p.length===0&&!E?.agent_soul?.name)return Ft(n,e,l);let R=[];if(l?.status==="completed"&&g)try{let N=g.checkCompleteness(n),C=g.checkStaleness(n);N.percentage<80&&N.gaps.length>0&&R.push(`
> Profile ${N.percentage}% complete. Missing: ${N.gaps.join(", ")}`),C.staleFields.length>0&&R.push(`
> Some profile fields not updated in 90+ days: ${C.staleFields.join(", ")}`)}catch(N){c.debug("CONTEXT","Completeness check failed (non-blocking)",{error:String(N)})}let T=new L(t.tokenBudget||3e3),f=[];try{f=a.getCompiledKnowledge(n)}catch{}return bs(n,d,p,t,s,r?.session_id,e,E,m,u,T,R,f)}finally{a.close()}}0&&(module.exports={generateContext});
