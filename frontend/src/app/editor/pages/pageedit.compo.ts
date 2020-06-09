/*
 * Copyright WebGate Consulting AG, 2020
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at:
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * permissions and limitations under the License.
 *
 */

import { Component, Input, OnInit } from '@angular/core';
import { BackendService } from 'src/app/services/backend.service';
import { Page } from './page';
import { MatDialog } from '@angular/material';
import { PublishDialogComponent } from './dialogs/PublishDialog';
import { MTSelectDialogComponent } from './dialogs/MTSelectDialog';
import { MTContentDialogComponent } from './dialogs/MTContentDialog';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { TabsNavService } from 'src/app/services/tabs.service';
import { environment } from '../../../environments/environment';
import { Auth } from '@aws-amplify/auth';
import { FileSelectionDialogComponent } from './dialogs/FileSelectionDialog';

declare var window: any;

@Component({
  selector: 'app-pageedit',
  templateUrl: './pageedit.compo.html',
  styleUrls: ['./mttable.component.css']
})

export class PageEditComponent implements OnInit {
  @Input() docid: string;
  @Input() tabid: string;

  constructor(
    private tabsSVC: TabsNavService,
    private backendSVC: BackendService,
    public dialog: MatDialog
  ) { }

  loading = true;
  viewList: any = [];
  page: Page = new Page();
  layouts: any = [];
  errorMessage: any;
  custFields: any = [];
  custFieldsReady: boolean;
  config: any;
  pathlist: string[] = [];
  pathlistFilter: string[];
  pathHint = '';

  trumbooptions: any = { // any, because of missing "semantic" prop. in ngx-trumbowyg
    lang: 'en',
    svgPath: 'assets/img/trumbowyg-icons.svg',
    semantic: { div: 'div' }, // prevent converting <div> to <p>
    removeformatPasted: true,
    resetCss: true,
    autogrow: true,
    imageWidthModalEdit: true,
    btns: [
      ['formatting'],
      ['fontsize'],
      ['strong', 'em', 'del'],
      ['link'],
      ['insertImage'], ['cdnplugin'],
      ['justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'],
      ['unorderedList', 'orderedList'],
      ['horizontalRule'],
      ['removeformat'],
      ['viewHTML'],
      ['fullscreen']
    ],
    events: {},
    plugins: environment.trumbooptions.plugins
  };

  ngOnInit() {
    const that = this;
    // if trumboeditor plugins are enabled, get auth token for uploader
    if (environment.trumbo_load_plugins) {
      // Note: this token will not be refreshed automatically.
      // We might switch to signed S3 upload instead, as we did for ckeditor
      Auth.currentSession()
        .then(data => {
          // TODO: move this to a window.pubfn in app.component.ts function to prevent token from expiring
          that.trumbooptions.plugins.upload.headers.Authorization = data.getIdToken().getJwtToken();
          window.loadTrumboPlugins();
        })
        .catch(err => console.warn('Failed to aquire token for trumbo_uploader_plugin', err));
    }
    this.loadConfig();
    if (this.docid === 'NEW') { this.tabsSVC.setTabTitle(this.tabid, 'New Page'); }
    this.loadPageByID(this.docid);
  }
  loadConfig() {
    const that = this;
    this.backendSVC.getConfig(false).then(
      (rc: any) => {
        that.config = rc.cfg;
      },
      (err) => {
        that.tabsSVC.printNotification('Error while loading configuration');
      }
    );
  }
  loadPathList() {
    // Load cached list of already existing paths
    const that = this;
    this.backendSVC.getAllPages(true).then(
      (data: any) => {
        that.pathlist = [];
        data.lstPages.forEach(pgEntry => {
          if (pgEntry.id !== that.page.id) { that.pathlist.push(pgEntry.opath); }
        });
        that.pathlist.sort();
        that.setLoading(false);
      },
      (err) => {
        that.tabsSVC.printNotification('Error while loading');
        console.log(err);
        that.setLoading(false);
      }
    );
  }
  loadPageByID(id: string) {
    const that = this;
    this.backendSVC.getPageByID(id).then(
      (data: any) => {
        that.setLoading(false);
        if (data.item) {
          that.page = data.item;
          that.layouts = data.layouts;
          if (that.docid === 'NEW') {
            that.tabsSVC.changeTabID(that.tabid, 'tab-page-' + that.page.id, that.page.id);
            that.tabid = 'tab-page-' + that.page.id;
            that.docid = that.page.id;
          }
          that.loadPathList();
          that.tabsSVC.setTabTitle(that.tabid, data.item.title || 'Untitled page');
          if (!that.page.lstMTObj) { that.page.lstMTObj = {}; }
          if (!that.page.doc) { that.page.doc = {}; }
          that.loadCustFields();
        }
      },
      (err) => {
        that.tabsSVC.printNotification('Error while loading page');
        that.setLoading(false);
      }
    );
  }
  checkPath(): void {
    const thisPath = this.page.opath || '';
    if (thisPath !== '') {
      if (thisPath.startsWith('/')) {
        this.pathHint = 'Path can not start with /';
        return;
      } else if (thisPath.indexOf('\\') >= 0) {
        this.pathHint = 'Use forward slashes!';
        return;
      } else if (thisPath.indexOf(' ') >= 0) {
        this.pathHint = 'No spaces allowed in path!';
        return;
      } else if (this.isDuplicatePath(thisPath)) {
        this.pathHint = 'Another page for this path already exists!';
        return;
      }
    }
    this.pathHint = '';
    this.pathlistFilter = this.pathFilter(thisPath);
  }
  isDuplicatePath(thisPath: string): boolean {
    for (const paths in this.pathlist) {
      if (this.pathlist[paths] === thisPath) { return true; }
    }
    return false;
  }
  private pathFilter(value: string): string[] {
    const filterValue = value.toLowerCase();
    if (value === '') { return []; }
    return this.pathlist.filter(option => option.toLowerCase().startsWith(filterValue));
  }
  loadCustFields() {
    // tslint:disable-next-line: prefer-for-of
    for (let i = 0; i < this.layouts.length; i++) {
      if (this.layouts[i].id === this.page.layout) {
        this.custFields = this.layouts[i].custFields;
        this.custFieldsReady = true;
        return;
      }
    }
  }

  onLayoutChange() {
    this.loadCustFields();
  }

  canPublish() { // toggle publish button visibility
    if (!this.page || this.page.id === '') { return false; }
    if (!this.page.opath || this.page.opath === '') { return false; }
    if (!this.page.layout || this.page.layout === '') { return false; }
    return true;
  }

  savePage() {
    const that = this;
    if (this.pathHint !== '') {
      alert(`Please correct the path field:\n${this.pathHint}`);
      return;
    }
    this.setLoading(true);
    this.errorMessage = '';
    this.backendSVC.savePage(this.page).then(
      (data: any) => {
        that.page.id = data.id;
        that.setLoading(false);
        if (data.success) { that.tabsSVC.printNotification('Document saved'); }
        that.tabsSVC.setTabTitle(that.tabid, that.page.title);
        that.tabsSVC.setTabDataExpired('tab-pages', true);
      },
      (err) => {
        console.error(err);
        that.errorMessage = JSON.stringify(err);
        that.tabsSVC.printNotification('Error while saving');
        that.setLoading(false);
      }
    );
  }

  btnDlgPublish(): void {
    if (!this.page.opath || this.page.opath === '') {
      this.errorMessage = 'Path must be supplied!';
      return;
    }
    if (this.page.opath.startsWith('/') || this.page.opath.startsWith('\\')) {
      this.errorMessage = 'Path can not start with a slash';
      return;
    }
    if (this.page.opath.endsWith('/') || this.page.opath.endsWith('\\')) {
      this.errorMessage = 'Path can not end with a slash';
      return;
    }
    this.dialog.open(PublishDialogComponent, { width: '650px', disableClose: false, data: { page: this.page, config: this.config } });
  }
  btnDlgSelectImage(fldName: string): void {
    const that = this;
    const dialogRef = this.dialog.open(FileSelectionDialogComponent,
      { width: '650px', disableClose: false, data: {
        selectedBucket: 'CDN', dlgTitle: 'Select image', fileFilter: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'tif', 'tiff']
        }}
    );
    dialogRef.afterClosed().subscribe(result => {
      if (result && result.action === 'add') {
        that.page.doc[fldName] = result.fileurl;
      }
    });
  }
  btnAddNewObj(fld: any) {
    const that = this;
    const dialogRef = this.dialog.open(MTSelectDialogComponent, { width: '450px', disableClose: false, data: { fld } });
    dialogRef.afterClosed().subscribe(result => {
      if (result && result.action === 'add') {
        // tslint:disable-next-line: max-line-length
        if (!that.page.lstMTObj[fld.fldName]) { that.page.lstMTObj[fld.fldName] = { fldTitle: fld.fldTitle, fldName: fld.fldName, lstObj: [] }; }
        const selObj = that.page.lstMTObj[fld.fldName];
        selObj.lstObj.push(result.mt);
        this.btnEditObj(result.mt);
      }
    });
  }
  btnNavigateTo(npath: string): void {
    this.tabsSVC.navigateTo(npath);
  }
  btnEditObj(fldMT) {
    this.dialog.open(MTContentDialogComponent, { width: '800px', disableClose: false, data: { fldMT } });
  }
  btnDeleteObj(lst, fldMT, idx) {
    if (!confirm('Do you really want to delete \'' + fldMT.title + '\'?')) { return; }
    lst.splice(idx, 1);
  }
  dropSortObj(lst, event: CdkDragDrop<string[]>) {
    moveItemInArray(lst, event.previousIndex, event.currentIndex);
  }
  btnDuplicate() {
    if (!confirm('Create a copy of this page?')) { return false; }
    const that = this;
    this.backendSVC.duplicatePage(this.page.id).then(
      (data: any) => {
        if (data.success) {
          that.tabsSVC.printNotification('Document duplicated');
          that.tabsSVC.setTabDataExpired('tab-pages', true);
          that.btnNavigateTo('editor/pages/edit/' + data.newPageID);
        }
      },
      (err) => {
        that.tabsSVC.printNotification('Error while deleting');
        that.setLoading(false);
      }
    );
  }
  btnDelete() {
    // tslint:disable-next-line: max-line-length
    if (!confirm('Do you really want to delete this entry from the database?\nNote: this will not remove an already published version.')) { return false; }
    const that = this;
    this.backendSVC.deleteItemByID(this.page.id).then(
      (data: any) => {
        if (data.success) {
          that.tabsSVC.printNotification('Document deleted');
          that.tabsSVC.setTabDataExpired('tab-pages', true);
          that.tabsSVC.closeTabByID(that.tabid);
        }
      },
      (err) => {
        that.tabsSVC.printNotification('Error while deleting');
        that.setLoading(false);
      }
    );
  }

  setLoading(on: boolean) {
    this.loading = on;
    this.tabsSVC.setLoading(on);
  }
}
