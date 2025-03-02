import { Injectable } from '@angular/core';
import { BlocklyEditorState } from '../state/blockly-editor.state';
import { SketchStatus } from '../domain/sketch.status';
import { BackEndState } from '../state/backend.state';
import { ConnectionStatus } from '../domain/connection.status';
import { filter, pairwise, withLatestFrom } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { combineLatest, Observable, of } from 'rxjs';
import { WorkspaceStatus } from '../domain/workspace.status';
import { AppState } from '../state/app.state';
import { CodeEditorType } from '../domain/code-editor.type';
import { LogService } from '../services/log.service';
import * as Blockly from 'blockly/core';
import Arduino from '@leaphy-robotics/leaphy-blocks/generators/arduino';
import {blocks, blocksJs} from "@leaphy-robotics/leaphy-blocks/blocks/blocks";
import {CUSTOM_CONTEXT_MENU_VARIABLE_GETTER_SETTER_MIXIN,
    LIST_MODES_MUTATOR_MIXIN,
    LIST_MODES_MUTATOR_EXTENSION,
    IS_DIVISIBLEBY_MUTATOR_MIXIN,
    IS_DIVISIBLE_MUTATOR_EXTENSION,
    MATH_TOOLTIPS_BY_OP,
    LOGIC_TOOLTIPS_BY_OP,
    LOGIC_COMPARE_EXTENSION,
    TEXT_QUOTES_EXTENSION,
    APPEND_STATEMENT_INPUT_STACK,
    CONTROLS_IF_MUTATOR_MIXIN,
    CONTROLS_IF_TOOLTIP_EXTENSION,
    WHILE_UNTIL_TOOLTIPS
} from "@leaphy-robotics/leaphy-blocks/blocks/extensions";
import {defaultBlockStyles, categoryStyles, componentStyles} from "@leaphy-robotics/leaphy-blocks/theme/theme";
import {LeaphyCategory} from "../services/Toolbox/Category";
import {LeaphyToolbox} from "../services/Toolbox/Toolbox";

var Extensions = Blockly.Extensions;

@Injectable({
    providedIn: 'root',
})

// Defines the effects on the Blockly Editor that different state changes have
export class BlocklyEditorEffects {

    constructor(
        private blocklyState: BlocklyEditorState,
        private backEndState: BackEndState,
        private appState: AppState,
        private http: HttpClient,
        private logger: LogService
    ) {
        Blockly.registry.register(
            Blockly.registry.Type.TOOLBOX_ITEM,
            Blockly.ToolboxCategory.registrationName,
            LeaphyCategory, true);
        Blockly.registry.register(Blockly.registry.Type.TOOLBOX, Blockly.CollapsibleToolboxCategory.registrationName, LeaphyToolbox);
        Blockly.defineBlocksWithJsonArray(blocks)
        for (const [name, block] of Object.entries(blocksJs)) {
            Blockly.Blocks[name] = block;
        }


        // Variables:
        Extensions.registerMixin(
            'contextMenu_variableSetterGetter',
            CUSTOM_CONTEXT_MENU_VARIABLE_GETTER_SETTER_MIXIN);
        // // Math:
        Extensions.registerMutator(
            'math_is_divisibleby_mutator', IS_DIVISIBLEBY_MUTATOR_MIXIN,
            IS_DIVISIBLE_MUTATOR_EXTENSION);

        // Update the tooltip of 'math_change' block to reference the variable.
        Extensions.register(
            'math_change_tooltip',
            Extensions.buildTooltipWithFieldText('%{BKY_MATH_CHANGE_TOOLTIP}', 'VAR'));

        Extensions.registerMutator(
            'math_modes_of_list_mutator', LIST_MODES_MUTATOR_MIXIN,
            LIST_MODES_MUTATOR_EXTENSION);
        //
        Extensions.register('text_quotes', TEXT_QUOTES_EXTENSION)
        Extensions.register('appendStatementInputStack', APPEND_STATEMENT_INPUT_STACK)
        Extensions.register('logic_compare', LOGIC_COMPARE_EXTENSION);
        // // Tooltip extensions
        Extensions.register('controls_whileUntil_tooltip', Extensions.buildTooltipForDropdown('MODE', WHILE_UNTIL_TOOLTIPS));
        Extensions.register(
            'logic_op_tooltip',
            Extensions.buildTooltipForDropdown('OP', LOGIC_TOOLTIPS_BY_OP));
        Extensions.register(
            'math_op_tooltip',
            Extensions.buildTooltipForDropdown('OP', MATH_TOOLTIPS_BY_OP));
        //
        Extensions.registerMutator(
            'controls_if_mutator', CONTROLS_IF_MUTATOR_MIXIN, null,
            ['controls_if_elseif', 'controls_if_else']);
        Extensions.register('controls_if_tooltip', CONTROLS_IF_TOOLTIP_EXTENSION);

        // When the current language is set: Find and set the blockly translations
        this.appState.currentLanguage$
            .pipe(filter(language => !!language))
            .subscribe(async language => {
                const translations = await import(`node_modules/@leaphy-robotics/leaphy-blocks/msg/js/${language.code}.js`);
                Blockly.setLocale(translations.default);
            });

        // When the language is changed, save the workspace temporarily
        this.appState.changedLanguage$
            .pipe(filter(language => !!language))
            .subscribe(() => {
                this.blocklyState.setWorkspaceStatus(WorkspaceStatus.SavingTemp);
            });

        // When a reload config is found, restore the temp workspace
        combineLatest([this.appState.reloadConfig$, this.blocklyState.workspace$])
            .pipe(filter(([reloadConfig, blockly]) => !!reloadConfig && !!blockly))
            .subscribe(([,]) => {
                this.blocklyState.setWorkspaceStatus(WorkspaceStatus.FindingTemp);
            });

        // When all prerequisites are there, Create a new workspace and open the codeview if needed
        combineLatest([this.blocklyState.blocklyElement$, this.blocklyState.blocklyConfig$])
            .pipe(withLatestFrom(this.appState.selectedRobotType$))
            .pipe(filter(([[element, config], robotType]) => !!element && !!config && !!robotType && robotType !== this.appState.genericRobotType))
            .pipe(withLatestFrom(
                this.getXmlContent('./assets/blockly/base-toolbox.xml'),
                this.getXmlContent('./assets/blockly/leaphy-toolbox.xml'),
                this.getXmlContent('./assets/blockly/leaphy-start.xml')
            ))
            .subscribe(([[[element, config], robotType], baseToolboxXml, leaphyToolboxXml, startWorkspaceXml]) => {
                const LeaphyTheme = Blockly.Theme.defineTheme('leaphy', {
                    'blockStyles': defaultBlockStyles,
                    'categoryStyles': categoryStyles,
                    'componentStyles': componentStyles,
                    name: 'leaphy',
                })
                config.theme = LeaphyTheme;
                const parser = new DOMParser();
                const toolboxXmlDoc = parser.parseFromString(baseToolboxXml, 'text/xml');
                const toolboxElement = toolboxXmlDoc.getElementById('easyBloqsToolbox');
                const leaphyCategories = parser.parseFromString(leaphyToolboxXml, 'text/xml');
                const leaphyRobotCategory = leaphyCategories.getElementById(robotType.id);
                toolboxElement.prepend(leaphyRobotCategory);
                if (robotType.showLeaphyExtra) {
                    const leaphyExtraCategory = leaphyCategories.getElementById(`${robotType.id}_extra`);
                    toolboxElement.appendChild(leaphyExtraCategory);
                }
                const serializer = new XMLSerializer();
                const toolboxXmlString = serializer.serializeToString(toolboxXmlDoc);
                config.toolbox = toolboxXmlString;
                // @ts-ignore
                const workspace = Blockly.inject(element, config);
                const toolbox = workspace.getToolbox();
                toolbox.getFlyout().autoClose = false;
                const xml = Blockly.utils.xml.textToDom(startWorkspaceXml);
                Blockly.Xml.domToWorkspace(xml, workspace);
                this.blocklyState.setWorkspace(workspace);
                this.blocklyState.setToolboxXml(toolboxXmlString);
                toolbox.selectItemByPosition(0);
                toolbox.refreshTheme();

                setTimeout(() => this.blocklyState.setIsSideNavOpen(robotType.showCodeOnStart), 200);
            });

        // When a new project is started, reset the blockly code
        this.appState.selectedRobotType$
            .pipe(filter(robotType => !robotType))
            .subscribe(() => this.blocklyState.setCode(''))

        // When the robot selection changes, set the toolbox and initialWorkspace
        this.appState.selectedRobotType$
            .pipe(withLatestFrom(this.blocklyState.workspace$))
            .pipe(filter(([robotType, workspace]) => !!robotType && !!workspace))
            .pipe(withLatestFrom(
                this.getXmlContent('./assets/blockly/base-toolbox.xml'),
                this.getXmlContent('./assets/blockly/leaphy-toolbox.xml'),
                this.getXmlContent('./assets/blockly/leaphy-start.xml'),
            ))
            .subscribe(([[robotType, workspace], baseToolboxXml, leaphyToolboxXml, startWorkspaceXml]) => {
                const parser = new DOMParser();
                const toolboxXmlDoc = parser.parseFromString(baseToolboxXml, 'text/xml');
                const toolboxElement = toolboxXmlDoc.getElementById('easyBloqsToolbox');
                const leaphyCategories = parser.parseFromString(leaphyToolboxXml, 'text/xml');
                const leaphyRobotCategory = leaphyCategories.getElementById(robotType.id);
                toolboxElement.prepend(leaphyRobotCategory);
                const serializer = new XMLSerializer();
                const toolboxXmlString = serializer.serializeToString(toolboxXmlDoc);
                this.blocklyState.setToolboxXml(toolboxXmlString);

                workspace.clear();
                const xml = Blockly.utils.xml.textToDom(startWorkspaceXml);
                Blockly.Xml.domToWorkspace(xml, workspace);
            });

        // Update the toolbox when it changes
        this.blocklyState.toolboxXml$
            .pipe(withLatestFrom(this.blocklyState.workspace$))
            .pipe(filter(([toolbox, workspace]) => !!toolbox && !!workspace))
            .subscribe(([toolbox, workspace]) => workspace.updateToolbox(toolbox))

        // Subscribe to changes when the workspace is set
        this.blocklyState.workspace$
            .pipe(filter(workspace => !!workspace))
            .subscribe(workspace => {
                workspace.clearUndo();
                workspace.addChangeListener(Blockly.Events.disableOrphans);
                workspace.addChangeListener(async () => {
                    this.blocklyState.setCode(Arduino.workspaceToCode(workspace));
                    const xml = Blockly.Xml.workspaceToDom(workspace);
                    const prettyXml = Blockly.Xml.domToPrettyText(xml);
                    this.blocklyState.setWorkspaceXml(prettyXml);
                });
            });

        // When the WorkspaceStatus is set to loading, load in the latest workspace XML
        this.blocklyState.workspaceStatus$
            .pipe(filter(status => status === WorkspaceStatus.Restoring))
            .pipe(withLatestFrom(this.blocklyState.workspaceXml$, this.blocklyState.workspace$))
            .subscribe(([, workspaceXml, workspace]) => {
                workspace.clear();
                const xml = Blockly.utils.xml.textToDom(workspaceXml);
                Blockly.Xml.domToWorkspace(xml, workspace);
                this.blocklyState.setWorkspaceStatus(WorkspaceStatus.Clean);
            });

        // When the user presses undo or redo, trigger undo or redo on the workspace
        this.blocklyState.undo$
            .pipe(withLatestFrom(this.blocklyState.workspace$))
            .pipe(filter(([, workspace]) => !!workspace))
            .subscribe(([redo, workspace]) => workspace.undo(redo));

        // Changes in ConnectionStatus result in changes in SketchStatus
        this.backEndState.connectionStatus$
            .subscribe(connectionStatus => {
                switch (connectionStatus) {
                    case ConnectionStatus.Disconnected:
                    case ConnectionStatus.ConnectedToBackend:
                    case ConnectionStatus.WaitForRobot:
                        this.blocklyState.setSketchStatus(SketchStatus.UnableToSend);
                        break;
                    case ConnectionStatus.PairedWithRobot:
                        this.blocklyState.setSketchStatus(SketchStatus.ReadyToSend);
                        break;
                    default:
                        break;
                }
            });

        // When Advanced CodeEditor is Selected, set the workspace status to SavingTemp and hide the sideNav
        this.appState.codeEditorType$
            .pipe(
                pairwise(),
                filter(([previous, current]) => current === CodeEditorType.Advanced && current !== previous)
            )
            .subscribe(() => {
                this.blocklyState.setIsSideNavOpen(false);
                this.blocklyState.setWorkspaceStatus(WorkspaceStatus.SavingTemp)
            });

        // When the code editor is changed to beginner, set the workspace status to FindingTemp
        this.appState.codeEditorType$
            .pipe(
                pairwise(),
                filter(([previous, current]) => current === CodeEditorType.Beginner && current !== previous)
            )
            .subscribe(() => {
                this.blocklyState.setWorkspaceStatus(WorkspaceStatus.FindingTemp)
            });

        // Toggle the isSideNavOpen state
        this.blocklyState.isSideNavOpenToggled$
            .pipe(filter(isToggled => !!isToggled), withLatestFrom(this.blocklyState.isSideNavOpen$))
            .subscribe(([, isSideNavOpen]) => {
                this.blocklyState.setIsSideNavOpen(!isSideNavOpen);
            });

        // Toggle the isSoundOn state
        this.blocklyState.isSoundToggled$
            .pipe(filter(isToggled => !!isToggled), withLatestFrom(this.blocklyState.isSoundOn$))
            .subscribe(([, isSoundOn]) => {
                this.blocklyState.setIsSoundOn(!isSoundOn);
            });

        // When the sound is turned on off, update the Blockly function
        this.blocklyState.isSoundOn$
            .pipe(withLatestFrom(this.blocklyState.playSoundFunction$))
            .subscribe(([isSoundOn, basePlay]) => {
                if (!basePlay) {
                    basePlay = Blockly.WorkspaceAudio.prototype.play;
                    this.blocklyState.setPlaySoundFunction(basePlay);
                }
                Blockly.WorkspaceAudio.prototype.play = function (name, opt_volume) {
                    if (isSoundOn) {
                        basePlay.call(this, name, opt_volume);
                    }
                };
            });

        // When the code editor is changed, clear the projectFilePath
        this.appState.codeEditorType$
            .subscribe(() => this.blocklyState.setProjectFilePath(''));

        // When an new project is being saved, reset the WorkspaceStatus to SavingAs
        this.blocklyState.workspaceStatus$
            .pipe(filter(status => status === WorkspaceStatus.Saving))
            .pipe(withLatestFrom(
                this.blocklyState.projectFilePath$
            ))
            .pipe(filter(([, projectFilePath]) => !projectFilePath))
            .subscribe(() => {
                this.blocklyState.setWorkspaceStatus(WorkspaceStatus.SavingAs);
            });

        // React to messages received from the Backend
        this.backEndState.backEndMessages$
            .pipe(filter(message => !!message))
            .subscribe(message => {
                switch (message.event) {
                    case 'PREPARING_COMPILATION_ENVIRONMENT':
                    case 'COMPILATION_STARTED':
                    case 'COMPILATION_COMPLETE':
                    case 'UPDATE_STARTED':
                        this.blocklyState.setSketchStatusMessage(message.message);
                        break;
                    case 'ROBOT_REGISTERED':
                    case 'UPDATE_COMPLETE':
                        this.blocklyState.setSketchStatus(SketchStatus.ReadyToSend);
                        this.blocklyState.setSketchStatusMessage(null);
                        break;
                    case 'COMPILATION_FAILED':
                    case 'UPDATE_FAILED':
                        this.blocklyState.setSketchStatus(SketchStatus.UnableToSend);
                        this.blocklyState.setSketchStatusMessage(null);
                        break;
                    case 'WORKSPACE_SAVE_CANCELLED':
                        this.blocklyState.setWorkspaceStatus(WorkspaceStatus.Clean);
                        break;
                    case 'WORKSPACE_SAVED':
                        this.blocklyState.setProjectFilePath(message.payload);
                        this.blocklyState.setWorkspaceStatus(WorkspaceStatus.Clean);
                        break;
                    case 'WORKSPACE_SAVED_TEMP':
                        this.blocklyState.setWorkspaceStatus(WorkspaceStatus.Clean);
                        break;
                    case 'WORKSPACE_RESTORING':
                        this.blocklyState.setWorkspaceXml(message.payload.data as string);
                        this.blocklyState.setProjectFilePath(message.payload.projectFilePath);
                        this.blocklyState.setWorkspaceStatus(WorkspaceStatus.Restoring);
                        break;
                    case 'WORKSPACE_CODE_RESTORING':
                        this.blocklyState.setCode(message.payload.data as string);
                        this.blocklyState.setProjectFilePath(message.payload.projectFilePath);
                        this.blocklyState.setWorkspaceStatus(WorkspaceStatus.Restoring);
                        break;
                    case 'WORKSPACE_RESTORING_TEMP':
                        this.blocklyState.setWorkspaceXml(message.payload.data as string);
                        this.blocklyState.setWorkspaceStatus(WorkspaceStatus.Restoring);
                        break;
                    default:
                        break;
                }
            });
    }

    private getXmlContent(path: string): Observable<string> {
        return this.http
            .get(path, {
                headers: new HttpHeaders()
                    .set('Content-Type', 'text/xml')
                    .append('Access-Control-Allow-Methods', 'GET')
                    .append('Access-Control-Allow-Origin', '*')
                    .append('Access-Control-Allow-Headers',
                        'Access-Control-Allow-Headers, Access-Control-Allow-Origin, Access-Control-Request-Method'),
                responseType: 'text'
            })
    }
}
