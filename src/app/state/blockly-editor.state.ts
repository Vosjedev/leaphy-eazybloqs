import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SketchStatus } from '../domain/sketch.status';
import { scan } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class BlocklyEditorState {

  private initialCode = `void setup()
{

}

void loop()
{

}
  `;
  private codeSubject$ = new BehaviorSubject(this.initialCode);
  public code$ = this.codeSubject$.asObservable();

  private sketchStatusSubject$: BehaviorSubject<SketchStatus> = new BehaviorSubject(SketchStatus.UnableToSend);
  public sketchStatus$ = this.sketchStatusSubject$.asObservable();

  private sketchStatusMessageSubject$ = new BehaviorSubject('');
  public sketchStatusMessage$ = this.sketchStatusMessageSubject$.asObservable();

  private isSideNavOpenSubject$ = new BehaviorSubject(false);
  public isSideNavOpen$ = this.isSideNavOpenSubject$.asObservable()
    .pipe(scan((current) => !current));

  private toolboxXmlSubject$ = new BehaviorSubject(null);
  public toolboxXml$ = this.toolboxXmlSubject$.asObservable();

  public setCode(code: string): void {
    this.codeSubject$.next(code);
  }

  public setSketchStatus(status: SketchStatus) {
    this.sketchStatusSubject$.next(status);
  }

  public setSketchStatusMessage(message: string) {
    this.sketchStatusMessageSubject$.next(message);
  }

  public toggleIsSideNavOpen() {
    this.isSideNavOpenSubject$.next(true);
  }

  public setToolboxXml(toolboxXml: any) {
    this.toolboxXmlSubject$.next(toolboxXml);
  }
}
