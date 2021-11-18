import { HelperService } from './../../../sourcing/services/helper.service';
import { TranscriptService } from './../../../core/services/transcript/transcript.service';
import { SourcingService } from './../../../sourcing/services/sourcing/sourcing.service';
import { ChangeDetectorRef, Component, Input, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormGroup } from '@angular/forms';
import { forkJoin, Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import _ from 'lodash';
import { TranscriptMetadata } from './transcript';


@Component({
  selector: 'app-transcripts',
  templateUrl: './transcripts.component.html',
  styleUrls: ['./transcripts.component.scss']
})

export class TranscriptsComponent implements OnInit {
  @Input() contentObject;
  public transcriptForm: FormGroup;
  public langControl = "language";
  public languageOptions;
  public content = {
    "versionKey": "1637225603143",
    "identifier": "do_11340715459064627211839",
    "transcripts": [
      {
        "language": "English",
        "languageCode": "English",
        "identifier": "do_1134121521152491521479",
        "artifactUrl": "https://dockstorage.blob.core.windows.net/sunbird-content-dock/content/assets/do_1134121521152491521479/example.srt"
      },
      {
        "language": "Assamese",
        "languageCode": "Assamese",
        "identifier": "do_1134121521153720321480",
        "artifactUrl": "https://dockstorage.blob.core.windows.net/sunbird-content-dock/content/assets/do_1134121521153720321480/srt-e.srt"
      }
    ]
  };

  // @Todo -> contributor/ sourcing reviewer/ contribution reviewer/ sourcing admin/ contribution org admin
  public userRole = "contributor";

  constructor(private fb: FormBuilder,
    private cd: ChangeDetectorRef,
    private sourcingService: SourcingService,
    private transcriptService: TranscriptService,
    private helperService: HelperService
  ) { }

  ngOnInit(): void {
    this.languageOptions = [
      { name: "English", code: "English" },
      { name: "Hindi", code: "Hindi" },
      { name: "Assamese", code: "Assamese" },
      { name: "Bengali", code: "Bengali" },
      { name: "Gujarati", code: "Gujarati" },
      { name: "Kannada", code: "Kannada" },
      { name: "Malayalam", code: "Malayalam" },
      { name: "Marathi", code: "Marathi" },
      { name: "Nepali", code: "Nepali" },
      { name: "Odia", code: "Odia" },
      { name: "Punjabi", code: "Punjabi" },
      { name: "Tamil", code: "Tamil" },
      { name: "Telugu", code: "Telugu" },
      { name: "Urdu", code: "Urdu" },
      { name: "Sanskrit", code: "Sanskrit" },
      { name: "Maithili", code: "Maithili" },
      { name: "Munda", code: "Munda" },
      { name: "Santali", code: "Santali" },
      { name: "Juang", code: "Juang" },
      { name: "Ho", code: "Ho" }
    ];

    this.transcriptForm = this.fb.group({
      transcripts: this.fb.array([]),
      languages: this.fb.array([])
    });

    this.setFormValues(this.content.transcripts);
    this.addMore();
  }

  get transcripts() {
    return this.transcriptForm.get('transcripts') as FormArray;
  }

  get languages() {
    return this.transcriptForm.get('languages') as FormArray;
  }

  // 1. Create asset for identifier
  // 2. Create pre-signed url for asset identifier
  // 3. Upload file using pre-signed URL on s3
  // 4. Upload asset using pre-signed URL as file URL
  // 5. Update content using transcript meta property
  attachFile(event, index) {
    const file = event.target.files[0];

    if (!this.fileValidation(file)) {
      return false;
    }

    if (event.target.files && event.target.files.length) {
      const [file] = event.target.files;
      this.transcripts.controls[index]['file'] = file;
      this.transcripts.controls[index].patchValue(file.name);
    }
  }

  fileValidation(file) {
    // 1. File format validation
    // 2. file size validation
    return true;
  }

  // File validation
  // 1. mimeType validation
  replaceFile(index) {
    document.getElementById("attachFileInput" + index).click();
  }

  reset(index) {
    // @Todo use viewChildern referance instead of id
    (<HTMLInputElement>document.getElementById("attachFileInput" + index)).value = "";
    this.transcripts.controls[index].reset();
  }

  download() {
  }

  addMore() {
    this.transcripts.push(this.fb.control(''));
    this.languages.push(this.fb.control(''));
  }

  setFormValues (transcriptsMeta) {
    transcriptsMeta.forEach((element, index) => {
      this.addMore();
      let fileName = element.artifactUrl.split('/').pop();
      this.transcripts.controls[index].setValue(fileName);
      this.languages.controls[index].setValue(element.languageCode);
    });
  }

  languageChange(event) {
    console.log(event);
  }

  //1. Prepare transcript meta to update
  //2. Update content
  done() {
    const transcriptMeta = [];
    const assetRequest = [];
    // For newly created assets
    this.transcripts.controls.forEach((transcript, index) => {
      let transcriptMetadata: TranscriptMetadata = {};
      const language = this.languages.controls[index];
      const req = _.clone(this.createAssetReq);
      req.asset['name'] = _.get(transcript, 'value');
      req.asset['language'].push(_.get(language, 'value'));
      if (req.asset['name'] && req.asset['language'].length) {
        transcriptMetadata.language = _.get(language, 'value');
        transcriptMetadata.languageCode = _.get(language, 'value');
        const forkReq = this.sourcingService.createAsset(req).pipe(
          switchMap(asset => {
            transcriptMetadata.identifier = _.get(asset, 'result.identifier');
            return this.generatePreSignedUrl(asset, transcript);
          }),
          switchMap((rsp) => {
            transcript['preSignedResponse'] = rsp;
            const signedURL = transcript['preSignedResponse'].result.pre_signed_url;
            transcriptMetadata.artifactUrl = signedURL.split('?')[0];
            transcriptMeta.push(transcriptMetadata);
            return this.uploadToBlob(rsp, transcript);
          }),
          switchMap(response => {
            return this.updateAssetWithURL(transcript);
          })
        );
        assetRequest.push(forkReq);
      }
    });

    forkJoin(assetRequest).subscribe(response => {
      this.updateContent(response, transcriptMeta).subscribe(response => {
        console.log(response);
      }, error => {
        console.log("Something went wrong", error);
      });
    }, error => {
      console.log(error);
    });

    // API -> For new Create
    // 1. Create asset
    // 2. Get pre-signed url
    // 3. Upload asset on pre-signed URL
    // 4. Upload asset - artifact url
    // 5. Update content

    // API's => For edit asset / transcripts
    // 1. get pre-signed url using asset identifier
    // 2. upload asset on pre-signed url
    // 3. upload asset - artifact URL
    // 4. Update content
  }

  uploadToBlob(response, transcript): Observable<any> {
    try {
      const signedURL = response.result.pre_signed_url;
      const config = {
        processData: false,
        contentType: 'Asset',
        headers: {
          'x-ms-blob-type': 'BlockBlob'
        }
      };

      return this.transcriptService.http.put(signedURL, _.get(transcript, 'file'), config);
    } catch (err) {
      console.log(err);
    }
  }

  generatePreSignedUrl(asset, transcript): Observable<any> {
    try {
      const req = {
        "content": {
          "fileName": _.get(transcript, 'value')
        }
      };

      return this.sourcingService.generatePreSignedUrl(req, _.get(asset, 'result.identifier'));
    } catch (err) {
      throw err;
    }
  }

  updateAssetWithURL(transcript): Observable<any> {
    const signedURL = transcript['preSignedResponse'].result.pre_signed_url;
    const fileURL = signedURL.split('?')[0];

    var formData = new FormData();
    formData.append("fileUrl", fileURL);
    formData.append("mimeType", "application/x-subrip");

    const request = {
      data: formData
    };

    return this.sourcingService.uploadAsset(request, transcript['preSignedResponse'].result.identifier);
  }

  // 1. Get content as input
  // 2. Update content for transcripts object
  // -- Prepare transcript object
  updateContent(data, transcriptMeta): Observable<any> {
    const req = {
      content: {
        versionKey: this.content.versionKey,
        transcripts: transcriptMeta
      }
    };

    return this.helperService.updateContent(req, this.content.identifier);
  }

  get createAssetReq() {
    return {
      "asset": {
        "name": "",
        "mimeType": "application/x-subrip",
        "primaryCategory": "Video transcript",
        "mediaType": "text",
        "language": []
      }
    }
  }
}
